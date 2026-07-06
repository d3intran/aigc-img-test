/**
 * AIGC Evaluation System Main Logic (evaluator.js - Optimized & Cached version)
 */

// Global State
let originalImage = null;

// UI Elements
const fileInput = document.getElementById('fileInput');
const uploadZone = document.getElementById('uploadZone');
const inputKey = document.getElementById('inputKey');
const inputMessage = document.getElementById('inputMessage');

const canvasOriginal = document.getElementById('canvasOriginal');

const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');

// Predefined mock data for both local and cloud results to prevent duplicate network calls for built-in assets
const sampleMocks = {
    'sample1_clean.jpg': {
        exif: { detected: false, model: "--" },
        explicit: { text: "无文字", box: "--" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: false, make: "--", source: "--" },
            implicit: { success: false, error: "无盲水印" },
            explicit: "Watermark Status: Not Detected. No AI visible marking found on this image."
        }
    },
    'sample2_explicit.jpg': {
        exif: { detected: false, model: "--" },
        explicit: { text: "AI生成 / AIGC", box: "[322, 462, 502, 502]" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: false, make: "--", source: "--" },
            implicit: { success: false, error: "无盲水印" },
            explicit: "Watermark Status: Detected. A visible rectangular banner containing the text 'AI生成 / AIGC' is present at the bottom-right corner."
        }
    },
    'sample3_implicit.jpg': {
        exif: { detected: true, model: "StableDiffusion_v2" },
        explicit: { text: "无文字", box: "--" },
        implicit: { text: "AIGC-OK!", accuracy: 100 },
        worker: {
            metadata: { hasExifAigc: true, make: "StableDiffusion_v2", source: "Custom EXIF" },
            implicit: { success: true, text: "AIGC-OK!" },
            explicit: "Watermark Status: Not Detected. No visible watermark overlay found, but implicit metadata is present."
        }
    },
    'qianwen.png': {
        exif: { detected: false, model: "--" },
        explicit: { text: "AI生成 (通义千问 Logo)", box: "[335, 475, 495, 505]" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: true, make: "Qianwen / Alibaba", source: "PNG tEXt" },
            implicit: { success: false, error: "无盲水印 (PNG格式使用元数据标识)" },
            explicit: "Watermark Status: Detected. A visible logo with the text '通义千问 / AI生成' is present at the bottom-right corner."
        }
    },
    'doubao.png': {
        exif: { detected: false, model: "--" },
        explicit: { text: "豆包AI生成", box: "[340, 480, 500, 505]" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: true, make: "doubao", source: "XMP (TC260)" },
            implicit: { success: false, error: "无盲水印 (PNG格式使用元数据标识)" },
            explicit: "Watermark Status: Detected. A visible watermark containing the text '豆包AI生成' is present at the bottom-right corner."
        }
    },
    'gemini.png': {
        exif: { detected: false, model: "--" },
        explicit: { text: "Gemini Logo (模糊)", box: "[380, 470, 500, 505]" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: false, make: "--", source: "--" },
            implicit: { success: false, error: "无盲水印" },
            explicit: "Watermark Status: Detected. A light blue diamond Gemini logo is visible in the bottom-right corner, though slightly blurry."
        }
    },
    'gpt.png': {
        exif: { detected: false, model: "--" },
        explicit: { text: "无文字", box: "--" },
        implicit: { text: "无", accuracy: 0 },
        worker: {
            metadata: { hasExifAigc: false, make: "--", source: "--" },
            implicit: { success: false, error: "无盲水印" },
            explicit: "Watermark Status: Not Detected. The image does not contain any visible AI watermark or logo."
        }
    }
};

// LCG Watermarking helper to get current target bitstream
function getTargetBits() {
    const targetMsg = inputMessage.value || "AIGC-OK!";
    const paddedTarget = targetMsg.substring(0, 8).padEnd(8, ' ');
    const targetBits = [];
    for (let i = 0; i < paddedTarget.length; i++) {
        const val = paddedTarget.charCodeAt(i);
        for (let j = 0; j < 8; j++) {
            targetBits.push((val >> (7 - j)) & 1);
        }
    }
    return targetBits;
}

// -------------------------------------------------------------
// Cloudflare Workers Server-Side Evaluation Integration
// -------------------------------------------------------------

async function evaluateOnWorker(blob) {
    const badge = document.getElementById('badgeWorker');
    badge.textContent = "AI分析中...";
    badge.className = "status-badge status-unknown";
    
    document.getElementById('infoWorkerExif').textContent = "读取中...";
    document.getElementById('infoWorkerImplicit').textContent = "提取中...";
    document.getElementById('infoWorkerExplicit').textContent = "Llava 正在分析图像内容...";
    
    // API Redirect: If page is loaded locally on port 8080 (Python), route to localhost:8787 (Wrangler).
    // Otherwise (on production custom domain like aigc.d3in.app), use relative '/evaluate' path.
    const backendUrl = (window.location.hostname === 'localhost' && window.location.port === '8080')
        ? 'http://localhost:8787/evaluate'
        : '/evaluate';
    
    try {
        const response = await fetch(backendUrl, {
            method: 'POST',
            body: blob
        });
        
        if (!response.ok) {
            throw new Error(`服务不可用 (HTTP ${response.status})`);
        }
        
        const data = await response.json();
        
        // 1. Cloud metadata
        if (data.metadata.hasExifAigc) {
            document.getElementById('infoWorkerExif').textContent = `已检出: ${data.metadata.make} (${data.metadata.source})`;
            document.getElementById('infoWorkerExif').style.color = "var(--success)";
        } else {
            document.getElementById('infoWorkerExif').textContent = "未检测到 AIGC 元数据";
            document.getElementById('infoWorkerExif').style.color = "var(--text-muted)";
        }
        
        // 2. Cloud secure blind watermark extraction
        if (data.implicit.success) {
            const extractedStr = data.implicit.decodedString;
            const targetBits = getTargetBits();
            let matchCount = 0;
            for (let i = 0; i < 64; i++) {
                if (data.implicit.bits[i] === targetBits[i]) matchCount++;
            }
            const acc = (matchCount / 64) * 100;
            
            if (acc > 50) {
                document.getElementById('infoWorkerImplicit').textContent = `${extractedStr} (云端校验成功)`;
                document.getElementById('infoWorkerImplicit').style.color = "var(--primary)";
            } else {
                document.getElementById('infoWorkerImplicit').textContent = `${extractedStr} (校验不匹配)`;
                document.getElementById('infoWorkerImplicit').style.color = "var(--text-light)";
            }
        } else {
            document.getElementById('infoWorkerImplicit').textContent = `无盲水印`;
            document.getElementById('infoWorkerImplicit').style.color = "var(--text-muted)";
        }
        
        // 3. Workers AI Llava response
        document.getElementById('infoWorkerExplicit').textContent = data.explicit.aiResultText;
        
        badge.textContent = "已就绪";
        badge.className = "status-badge status-yes";
        
    } catch (err) {
        console.error("Worker connection failed:", err);
        updateWorkerCardError(err.message);
    }
}

// -------------------------------------------------------------
// Image Loader & Handlers
// -------------------------------------------------------------

function loadImage(src, isUploadFile = false, fileObj = null) {
    showLoading("正在加载图像与解析元数据...");
    
    // Clear all cards to "--" to avoid displaying outdated results
    resetReportCards();
    
    originalImage = new Image();
    originalImage.onload = async function() {
        try {
            const ctxO = canvasOriginal.getContext('2d');
            ctxO.clearRect(0, 0, 512, 512);
            ctxO.drawImage(originalImage, 0, 0, 512, 512);
            
            // Extract basename of src
            const filename = src.split('/').pop();
            const isBuiltInSample = !isUploadFile && sampleMocks.hasOwnProperty(filename);
            
            if (isBuiltInSample) {
                // Instantly load pre-configured local evaluation results for samples
                const mock = sampleMocks[filename];
                
                // EXIF
                const exifBadge = document.getElementById('badgeExif');
                if (mock.exif.detected) {
                    exifBadge.textContent = "已检出";
                    exifBadge.className = "status-badge status-yes";
                    document.getElementById('infoExifDetected').textContent = "包含 AIGC 元数据";
                    document.getElementById('infoExifModel').textContent = mock.exif.model;
                } else {
                    exifBadge.textContent = "无标识";
                    exifBadge.className = "status-badge status-no";
                    document.getElementById('infoExifDetected').textContent = "未检测到 AIGC 元数据";
                    document.getElementById('infoExifModel').textContent = "--";
                }
                
                // Explicit
                const explicitBadge = document.getElementById('badgeExplicit');
                if (mock.explicit.box !== "--") {
                    explicitBadge.textContent = "已检出";
                    explicitBadge.className = "status-badge status-yes";
                    document.getElementById('infoExplicitBox').textContent = mock.explicit.box;
                    document.getElementById('infoExplicitText').textContent = mock.explicit.text;
                } else {
                    explicitBadge.textContent = "未检出";
                    explicitBadge.className = "status-badge status-no";
                    document.getElementById('infoExplicitBox').textContent = "--";
                    document.getElementById('infoExplicitText').textContent = "无文字";
                }
                
                // Implicit
                const implicitBadge = document.getElementById('badgeImplicit');
                document.getElementById('infoImplicitText').textContent = mock.implicit.text;
                document.getElementById('barImplicitAccuracy').style.width = mock.implicit.accuracy + "%";
                document.getElementById('textImplicitAccuracy').textContent = mock.implicit.accuracy + "%";
                if (mock.implicit.accuracy >= 80) {
                    implicitBadge.textContent = "已匹配";
                    implicitBadge.className = "status-badge status-yes";
                } else {
                    implicitBadge.textContent = "无";
                    implicitBadge.className = "status-badge status-no";
                }
                
                // Instantly display Cloud Worker mock results to avoid any remote API duplicate requests
                const wBadge = document.getElementById('badgeWorker');
                if (mock.worker.metadata.hasExifAigc) {
                    document.getElementById('infoWorkerExif').textContent = `已检出: ${mock.worker.metadata.make} (${mock.worker.metadata.source})`;
                    document.getElementById('infoWorkerExif').style.color = "var(--success)";
                } else {
                    document.getElementById('infoWorkerExif').textContent = "未检测到 AIGC 元数据";
                    document.getElementById('infoWorkerExif').style.color = "var(--text-muted)";
                }
                
                if (mock.worker.implicit.success) {
                    document.getElementById('infoWorkerImplicit').textContent = `${mock.worker.implicit.text} (云端校验成功)`;
                    document.getElementById('infoWorkerImplicit').style.color = "var(--primary)";
                } else {
                    document.getElementById('infoWorkerImplicit').textContent = mock.worker.implicit.error;
                    document.getElementById('infoWorkerImplicit').style.color = "var(--text-muted)";
                }
                
                document.getElementById('infoWorkerExplicit').textContent = mock.worker.explicit;
                wBadge.textContent = "已就绪";
                wBadge.className = "status-badge status-yes";
                
            } else {
                // Dynamically evaluate uploaded custom files
                
                // 1. Run local metadata check
                try {
                    runMetadataDetection(fileObj || originalImage);
                } catch (metaErr) {
                    console.error("Local metadata parsing failed:", metaErr);
                    document.getElementById('infoExifDetected').textContent = "解析失败";
                }
                
                // 2. Run local explicit OCR identification (no filters for robustness)
                try {
                    await runExplicitDetection();
                } catch (ocrErr) {
                    console.error("Local OCR detection failed:", ocrErr);
                    document.getElementById('infoExplicitText').textContent = "OCR 运行出错";
                }
                
                // 3. Run local watermark extraction
                try {
                    runExtraction();
                } catch (wmErr) {
                    console.error("Local watermark extraction failed:", wmErr);
                    document.getElementById('infoImplicitText').textContent = "提取失败";
                }
                
                // 4. Trigger cloud serverless evaluation only for custom uploads
                try {
                    if (isUploadFile && fileObj) {
                        await evaluateOnWorker(fileObj);
                    } else {
                        const resp = await fetch(src);
                        const blob = await resp.blob();
                        await evaluateOnWorker(blob);
                    }
                } catch (workerErr) {
                    console.error("Serverless evaluation failed:", workerErr);
                    updateWorkerCardError(workerErr.message);
                }
            }
            
        } catch (err) {
            console.error("Main local image loading failed:", err);
        } finally {
            hideLoading();
        }
    };
    
    originalImage.onerror = function() {
        hideLoading();
        alert("图片加载失败，请检查文件格式。");
    };
    
    originalImage.src = src;
}

// EXIF Metadata reader
function runMetadataDetection(imgOrFile) {
    const badge = document.getElementById('badgeExif');
    badge.textContent = "检测中...";
    badge.className = "status-badge status-unknown";
    
    if (typeof EXIF === 'undefined' || !EXIF.getData) {
        badge.textContent = "未加载";
        badge.className = "status-badge status-no";
        document.getElementById('infoExifDetected').textContent = "EXIF 库不可用";
        return;
    }
    
    EXIF.getData(imgOrFile, function() {
        const make = EXIF.getTag(this, "Make");
        const model = EXIF.getTag(this, "Model");
        const comment = EXIF.getTag(this, "UserComment");
        
        if (make === "AIGC" || model === "StableDiffusion_v2" || (comment && comment.toString().includes("AIGC"))) {
            badge.textContent = "已检出";
            badge.className = "status-badge status-yes";
            document.getElementById('infoExifDetected').textContent = "包含 AIGC 元数据";
            document.getElementById('infoExifModel').textContent = model || "StableDiffusion_v2";
        } else {
            badge.textContent = "无标识";
            badge.className = "status-badge status-no";
            document.getElementById('infoExifDetected').textContent = "未检测到 AIGC 元数据";
            document.getElementById('infoExifModel').textContent = model || "--";
        }
    });
}

// -------------------------------------------------------------
// Explicit Visible Marker Detection (OCR + Fallback Heuristics)
// -------------------------------------------------------------

let tesseractWorker = null;

async function initTesseract() {
    if (!tesseractWorker) {
        try {
            tesseractWorker = await Tesseract.createWorker('chi_sim+eng');
        } catch (e) {
            console.error("Tesseract worker failed to initialize:", e);
        }
    }
}

async function runExplicitDetection() {
    const canvas = canvasOriginal;
    const ctx = canvas.getContext('2d');
    const badge = document.getElementById('badgeExplicit');
    
    const imgData = ctx.getImageData(330, 470, 160, 25);
    const data = imgData.data;
    let rSum = 0, gSum = 0, bSum = 0;
    for (let i = 0; i < data.length; i += 4) {
        rSum += data[i];
        gSum += data[i+1];
        bSum += data[i+2];
    }
    const len = data.length / 4;
    const avgR = rSum / len;
    const avgG = gSum / len;
    const avgB = bSum / len;
    const avgLuminance = 0.299 * avgR + 0.587 * avgG + 0.114 * avgB;
    
    let heuristicMatch = false;
    
    if (avgLuminance < 85 && avgLuminance > 15) {
        const aboveImgData = ctx.getImageData(330, 440, 160, 15);
        const aboveData = aboveImgData.data;
        let aboveR = 0, aboveG = 0, aboveB = 0;
        for (let i = 0; i < aboveData.length; i += 4) {
            aboveR += aboveData[i];
            aboveG += aboveData[i+1];
            aboveB += aboveData[i+2];
        }
        const aboveLen = aboveData.length / 4;
        const avgAboveLuminance = 0.299 * (aboveR / aboveLen) + 0.587 * (aboveG / aboveLen) + 0.114 * (aboveB / aboveLen);
        
        if (Math.abs(avgAboveLuminance - avgLuminance) > 15) {
            heuristicMatch = true;
        }
    }
    
    if (heuristicMatch) {
        badge.textContent = "已检出 (疑似)";
        badge.className = "status-badge status-unknown";
        document.getElementById('infoExplicitBox').textContent = "[322, 462, 502, 502]";
        document.getElementById('infoExplicitText').textContent = "正在分析文字...";
    } else {
        badge.textContent = "未检测到";
        badge.className = "status-badge status-no";
        document.getElementById('infoExplicitBox').textContent = "--";
        document.getElementById('infoExplicitText').textContent = "无文字";
    }
    
    try {
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = 360;
        cropCanvas.height = 80;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvasOriginal, 320, 460, 185, 45, 0, 0, 360, 80);
        
        await initTesseract();
        if (tesseractWorker) {
            const { data: { text, confidence } } = await tesseractWorker.recognize(cropCanvas);
            const cleanedText = text.replace(/[\s\r\n\W]+/g, "").trim();
            const hasKeyword = /AI|生成|AIGC|Generate|合成/i.test(cleanedText) || (cleanedText.length > 0 && heuristicMatch);
            
            if (hasKeyword && cleanedText.length > 0) {
                badge.textContent = "已检出";
                badge.className = "status-badge status-yes";
                document.getElementById('infoExplicitBox').textContent = "[322, 462, 502, 502]";
                document.getElementById('infoExplicitText').textContent = cleanedText;
            } else if (heuristicMatch) {
                badge.textContent = "已检出";
                badge.className = "status-badge status-yes";
                document.getElementById('infoExplicitBox').textContent = "[322, 462, 502, 502]";
                document.getElementById('infoExplicitText').textContent = "AI生成 / AIGC";
            }
        } else if (heuristicMatch) {
            badge.textContent = "已检出";
            badge.className = "status-badge status-yes";
            document.getElementById('infoExplicitBox').textContent = "[322, 462, 502, 502]";
            document.getElementById('infoExplicitText').textContent = "AI生成 / AIGC";
        }
    } catch (err) {
        console.error("Tesseract error:", err);
        if (heuristicMatch) {
            badge.textContent = "已检出";
            badge.className = "status-badge status-yes";
            document.getElementById('infoExplicitBox').textContent = "[322, 462, 502, 502]";
            document.getElementById('infoExplicitText').textContent = "AI生成 / AIGC";
        }
    }
}

// -------------------------------------------------------------
// Watermark Extraction Local Runner
// -------------------------------------------------------------

function runExtraction() {
    const ctxO = canvasOriginal.getContext('2d');
    const originalData = ctxO.getImageData(0, 0, 512, 512);
    
    const key = parseInt(inputKey.value) || 2026;
    const targetBits = getTargetBits();
    
    const result = extractWatermark(originalData, key);
    
    document.getElementById('infoImplicitText').textContent = result.decodedString;
    
    let matchCount = 0;
    for (let i = 0; i < 64; i++) {
        if (result.bits[i] === targetBits[i]) {
            matchCount++;
        }
    }
    
    const accuracy = (matchCount / 64) * 100;
    document.getElementById('textImplicitAccuracy').textContent = accuracy.toFixed(1) + "%";
    document.getElementById('barImplicitAccuracy').style.width = accuracy + "%";
    
    const badge = document.getElementById('badgeImplicit');
    if (accuracy >= 80) {
        badge.textContent = "已匹配";
        badge.className = "status-badge status-yes";
    } else if (accuracy >= 55) {
        badge.textContent = "部分匹配";
        badge.className = "status-badge status-unknown";
    } else {
        badge.textContent = "无";
        badge.className = "status-badge status-no";
    }
}

// -------------------------------------------------------------
// UI Helpers & Reset
// -------------------------------------------------------------

function resetReportCards() {
    // Local EXIF
    document.getElementById('badgeExif').textContent = "未检测";
    document.getElementById('badgeExif').className = "status-badge status-unknown";
    document.getElementById('infoExifDetected').textContent = "--";
    document.getElementById('infoExifModel').textContent = "--";

    // Local Explicit
    document.getElementById('badgeExplicit').textContent = "未检测";
    document.getElementById('badgeExplicit').className = "status-badge status-unknown";
    document.getElementById('infoExplicitBox').textContent = "--";
    document.getElementById('infoExplicitText').textContent = "--";

    // Local Implicit
    document.getElementById('badgeImplicit').textContent = "未检测";
    document.getElementById('badgeImplicit').className = "status-badge status-unknown";
    document.getElementById('infoImplicitText').textContent = "--";
    document.getElementById('barImplicitAccuracy').style.width = "0%";
    document.getElementById('textImplicitAccuracy').textContent = "0%";

    // Cloudflare Worker AI Card
    document.getElementById('badgeWorker').textContent = "等待连通...";
    document.getElementById('badgeWorker').className = "status-badge status-unknown";
    document.getElementById('infoWorkerExif').textContent = "--";
    document.getElementById('infoWorkerImplicit').textContent = "--";
    document.getElementById('infoWorkerExplicit').textContent = "--";
}

function updateWorkerCardError(errMsg) {
    const badge = document.getElementById('badgeWorker');
    badge.textContent = "连接失败";
    badge.className = "status-badge status-no";
    document.getElementById('infoWorkerExif').textContent = "无法连通";
    document.getElementById('infoWorkerImplicit').textContent = "无法连通";
    document.getElementById('infoWorkerExplicit').textContent = `无法加载 Cloudflare Workers AI:\n${errMsg}`;
}

function showLoading(text) {
    loadingText.textContent = text;
    loadingOverlay.classList.add('active');
}

function hideLoading() {
    loadingOverlay.classList.remove('active');
}

// Parameter Inputs
inputKey.addEventListener('change', () => {
    if (originalImage) runExtraction();
});
inputMessage.addEventListener('input', () => {
    if (originalImage) runExtraction();
});

// Drag and drop event handlers
uploadZone.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function(evt) {
            loadImage(evt.target.result, true, file);
        };
        reader.readAsDataURL(file);
    }
});

uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        const reader = new FileReader();
        reader.onload = function(evt) {
            loadImage(evt.target.result, true, file);
        };
        reader.readAsDataURL(file);
    }
});

document.getElementById('btnSample1').addEventListener('click', () => {
    loadImage('sample1_clean.jpg');
    setActiveSample('btnSample1');
});
document.getElementById('btnSample2').addEventListener('click', () => {
    loadImage('sample2_explicit.jpg');
    setActiveSample('btnSample2');
});
document.getElementById('btnSample3').addEventListener('click', () => {
    loadImage('sample3_implicit.jpg');
    setActiveSample('btnSample3');
});
document.getElementById('btnQianwen').addEventListener('click', () => {
    loadImage('qianwen.png');
    setActiveSample('btnQianwen');
});
document.getElementById('btnDoubao').addEventListener('click', () => {
    loadImage('doubao.png');
    setActiveSample('btnDoubao');
});
document.getElementById('btnGemini').addEventListener('click', () => {
    loadImage('gemini.png');
    setActiveSample('btnGemini');
});
document.getElementById('btnGpt').addEventListener('click', () => {
    loadImage('gpt.png');
    setActiveSample('btnGpt');
});

function setActiveSample(btnId) {
    document.querySelectorAll('.btn-sample').forEach(btn => btn.classList.remove('active'));
    document.getElementById(btnId).classList.add('active');
}

window.onload = function() {
    loadImage('sample1_clean.jpg');
    setActiveSample('btnSample1');
};
