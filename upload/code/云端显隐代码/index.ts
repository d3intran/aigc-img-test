import jpeg from 'jpeg-js';

export interface Env {
	AI: any;
}

class LCG {
	private state: number;
	constructor(seed: number) {
		this.state = seed;
	}
	nextFloat(): number {
		this.state = (Math.imul(1103515245, this.state) + 12345) & 0x7fffffff;
		return this.state / 2147483648;
	}
}

// Advanced binary metadata scanner for real-world AIGC PNG/JPEG images
interface AigcMetadataResult {
	source: string;
	producer: string;
	model: string;
	rawData: string;
}

function extractAigcMetadata(buffer: ArrayBuffer): AigcMetadataResult | null {
	const view = new Uint8Array(buffer);
	const textDecoder = new TextDecoder("utf-8", { fatal: false });
	
	// Helper to find a specific string sequence in the byte array
	function findSequence(seq: string): number {
		const seqBytes = new TextEncoder().encode(seq);
		for (let i = 0; i <= view.length - seqBytes.length; i++) {
			let match = true;
			for (let j = 0; j < seqBytes.length; j++) {
				if (view[i + j] !== seqBytes[j]) {
					match = false;
					break;
				}
			}
			if (match) return i;
		}
		return -1;
	}
	
	// 1. Scan for Doubao XMP style metadata: <TC260:AIGC>... </TC260:AIGC>
	const dbIdx = findSequence("<TC260:AIGC>");
	if (dbIdx !== -1) {
		const endIdx = findSequence("</TC260:AIGC>");
		if (endIdx !== -1 && endIdx > dbIdx) {
			const snippet = view.slice(dbIdx + 12, endIdx);
			try {
				const decoded = textDecoder.decode(snippet);
				const jsonStr = decoded.replace(/&quot;/g, '"'); // Unescape JSON
				const parsed = JSON.parse(jsonStr);
				return {
					source: "XMP (TC260)",
					producer: parsed.ContentProducer || "Doubao",
					model: parsed.ProduceID ? `Task: ${parsed.ProduceID}` : "Doubao-Generator",
					rawData: jsonStr
				};
			} catch (e) {
				console.error("Failed to parse Doubao XMP JSON:", e);
			}
		}
	}
	
	// 2. Scan for Qianwen PNG tEXt metadata: "AIGC" followed by JSON string
	const qwIdx = findSequence("AIGC");
	if (qwIdx !== -1) {
		let jsonStart = -1;
		for (let i = qwIdx + 4; i < qwIdx + 100; i++) {
			if (view[i] === 123) { // Find '{'
				jsonStart = i;
				break;
			}
		}
		if (jsonStart !== -1) {
			let jsonEnd = -1;
			let braceCount = 0;
			for (let i = jsonStart; i < jsonStart + 2000; i++) {
				if (view[i] === 123) braceCount++;
				if (view[i] === 125) {
					braceCount--;
					if (braceCount === 0) {
						jsonEnd = i;
						break;
					}
				}
			}
			if (jsonEnd !== -1) {
				const snippet = view.slice(jsonStart, jsonEnd + 1);
				try {
					const decoded = textDecoder.decode(snippet);
					const parsed = JSON.parse(decoded);
					return {
						source: "PNG tEXt (AIGC)",
						producer: parsed.ContentProducer === "001191440101MA9Y9T4H7A00000" ? "Qianwen / Alibaba" : (parsed.ContentProducer || "Alibaba"),
						model: parsed.ProduceID ? `ID: ${parsed.ProduceID.split("/")[0]}` : "Qianwen-Generator",
						rawData: decoded
					};
				} catch (e) {
					console.error("Failed to parse Qianwen PNG JSON:", e);
				}
			}
		}
	}
	
	// 3. Scan for our custom sample watermark tags
	if (findSequence("AIGC_Implicit_Watermarked_Identifier") !== -1) {
		return {
			source: "Custom EXIF",
			producer: "StableDiffusion_v2",
			model: "SD-v2-Watermarked",
			rawData: '{"Label":"1","Comment":"AIGC_Implicit_Watermarked_Identifier"}'
		};
	}
	
	return null;
}

// Resizes decoded RGBA image data to 512x512 using nearest-neighbor scaling
function resizeRGBA(data: Uint8Array, width: number, height: number, targetWidth: number, targetHeight: number): Uint8Array {
	const resized = new Uint8Array(targetWidth * targetHeight * 4);
	const xRatio = width / targetWidth;
	const yRatio = height / targetHeight;
	for (let y = 0; y < targetHeight; y++) {
		for (let x = 0; x < targetWidth; x++) {
			const px = Math.floor(x * xRatio);
			const py = Math.floor(y * yRatio);
			const srcIdx = (py * width + px) * 4;
			const destIdx = (y * targetWidth + x) * 4;
			resized[srcIdx] = data[srcIdx];         // R
			resized[srcIdx + 1] = data[srcIdx + 1]; // G
			resized[resized[destIdx + 2]] = data[srcIdx + 2]; // B
			resized[destIdx + 3] = data[srcIdx + 3]; // A
		}
	}
	return resized;
}

// Service-side LCG spread spectrum spatial-domain watermark extraction
function extractWatermark(data: Uint8Array, width: number, height: number, key: number) {
	let pixelData = data;
	if (width !== 512 || height !== 512) {
		pixelData = resizeRGBA(data, width, height, 512, 512);
	}
	
	const extractedBits: number[] = [];
	
	for (let b = 0; b < 64; b++) {
		const bx = b % 8;
		const by = Math.floor(b / 8);
		
		const lcg = new LCG(key + b);
		const pattern = new Float32Array(64 * 64);
		for (let i = 0; i < 64 * 64; i++) {
			pattern[i] = lcg.nextFloat() > 0.5 ? 1.0 : -1.0;
		}
		
		let sumVal = 0.0;
		for (let y = 1; y < 63; y++) {
			for (let x = 1; x < 63; x++) {
				const px = bx * 64 + x;
				const py = by * 64 + y;
				
				let localSum = 0.0;
				for (let dy = -1; dy <= 1; dy++) {
					for (let dx = -1; dx <= 1; dx++) {
						const idx = ((py + dy) * 512 + (px + dx)) * 4;
						localSum += pixelData[idx + 2]; // Blue channel
					}
				}
				const localMean = localSum / 9.0;
				
				const idx = (py * 512 + px) * 4;
				const hp = pixelData[idx + 2] - localMean;
				const p = pattern[y * 64 + x];
				sumVal += hp * p;
			}
		}
		extractedBits.push(sumVal > 0 ? 1 : 0);
	}
	
	const chars: string[] = [];
	for (let i = 0; i < 8; i++) {
		let byteVal = 0;
		for (let j = 0; j < 8; j++) {
			byteVal |= (extractedBits[i * 8 + j] << (7 - j));
		}
		if (byteVal >= 32 && byteVal <= 126) {
			chars.push(String.fromCharCode(byteVal));
		} else {
			chars.push('?');
		}
	}
	
	return {
		decodedString: chars.join(""),
		bits: extractedBits
	};
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const corsHeaders = {
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type",
		};

		if (request.method === "OPTIONS") {
			return new Response(null, { headers: corsHeaders });
		}

		const url = new URL(request.url);
		
		if (url.pathname === "/evaluate" && request.method === "POST") {
			try {
				const contentType = request.headers.get("content-type") || "";
				let arrayBuffer: ArrayBuffer;
				
				if (contentType.includes("multipart/form-data")) {
					const formData = await request.formData();
					const file = formData.get("image") as File;
					if (!file) {
						return new Response(JSON.stringify({ error: "Missing image file in form data" }), { 
							status: 400, 
							headers: { ...corsHeaders, "Content-Type": "application/json" } 
						});
					}
					arrayBuffer = await file.arrayBuffer();
				} else {
					arrayBuffer = await request.arrayBuffer();
				}

				if (arrayBuffer.byteLength === 0) {
					return new Response(JSON.stringify({ error: "Empty request body" }), { 
						status: 400, 
						headers: { ...corsHeaders, "Content-Type": "application/json" } 
					});
				}

				// 1. Identify Format
				const view = new Uint8Array(arrayBuffer);
				const isPng = view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4e && view[3] === 0x47;
				const isJpeg = view[0] === 0xff && view[1] === 0xd8;

				// 2. Scan for AIGC Metadata (Works on both formats)
				const metadataInfo = extractAigcMetadata(arrayBuffer);

				// 3. Decode Pixel-level blind watermark (Only run on JPEG due to custom watermark template)
				let implicitResult = null;
				let decodeError = null;

				if (isJpeg) {
					try {
						const decoded = jpeg.decode(arrayBuffer, { useTArray: true });
						implicitResult = extractWatermark(decoded.data, decoded.width, decoded.height, 2026);
					} catch (err: any) {
						decodeError = err.message || "Failed to decode JPEG image";
					}
				} else if (isPng) {
					// PNG images from commercial AI engines (like Doubao/Qianwen) don't use LCG.
					// We report this gracefully instead of trying to run JPEG decode.
					decodeError = "PNG格式说明: 商业生成引擎通常将隐式标识嵌入在元数据(如XMP)中，而不适用于系统内置的本地LCG像素水印算法。";
				} else {
					decodeError = "不受支持的图像格式。请使用 JPEG 或 PNG。";
				}

				// 4. Call Cloudflare Workers AI for explicit logo detection via Llava
				let explicitAiResult = "未执行 AI 识别。";
				let hasAiService = false;
				
				if (env.AI) {
					hasAiService = true;
					try {
						// Pass the image directly to Workers AI Llava 1.5 model
						const imageArray = Array.from(new Uint8Array(arrayBuffer));
						const aiResponse = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
							image: imageArray,
							prompt: "Assess the bottom-right corner of this image. Is there a visible watermark, AI logo, or text indicating it is AI-generated (such as 'AI生成', 'AIGC', or a model logo like Doubao/Qianwen)? Respond with 'Watermark Status: Detected' or 'Watermark Status: Not Detected' followed by a brief description.",
							max_tokens: 128
						});
						explicitAiResult = aiResponse.response || "No response text.";
					} catch (aiErr: any) {
						explicitAiResult = `Workers AI Error: ${aiErr.message || aiErr}`;
					}
				}

				// 5. Package results
				const responseData = {
					metadata: {
						hasExifAigc: metadataInfo !== null,
						source: metadataInfo ? metadataInfo.source : "None",
						make: metadataInfo ? metadataInfo.producer : "--",
						model: metadataInfo ? metadataInfo.model : "--",
						comment: metadataInfo ? metadataInfo.rawData : "--"
					},
					implicit: implicitResult ? {
						success: true,
						decodedString: implicitResult.decodedString,
						bits: Array.from(implicitResult.bits)
					} : {
						success: false,
						error: decodeError
					},
					explicit: {
						aiServiceAvailable: hasAiService,
						aiResultText: explicitAiResult
					}
				};

				return new Response(JSON.stringify(responseData), {
					status: 200,
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});

			} catch (globalErr: any) {
				return new Response(JSON.stringify({ error: globalErr.message || "Internal Server Error" }), {
					status: 500,
					headers: { ...corsHeaders, "Content-Type": "application/json" }
				});
			}
		}

		return new Response("Not Found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
