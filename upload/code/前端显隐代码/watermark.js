/**
 * AIGC Blind Watermarking Library (LCG Spread Spectrum Spatial-Domain)
 * 
 * Matches Python implementation exactly for cross-compatibility.
 */

class LCG {
    constructor(seed) {
        this.state = seed;
    }
    nextFloat() {
        this.state = (Math.imul(1103515245, this.state) + 12345) & 0x7fffffff;
        return this.state / 2147483648;
    }
}

/**
 * Embeds a 64-bit watermark (8 characters) into the blue channel of a 512x512 image.
 * 
 * @param {ImageData} imageData - The canvas ImageData object (must be 512x512).
 * @param {number} key - Watermark secret key (default: 2026).
 * @param {string} message - Watermark message (exactly 8 chars, ASCII).
 * @param {number} alpha - Watermark embedding strength (default: 15).
 */
function embedWatermark(imageData, key, message, alpha = 15) {
    if (imageData.width !== 512 || imageData.height !== 512) {
        throw new Error("Watermark embedding requires a 512x512 image.");
    }
    
    const width = imageData.width;
    const data = imageData.data;
    
    // Convert 8-char message to 64 bits
    let paddedMessage = message.substring(0, 8).padEnd(8, ' ');
    const bits = [];
    for (let i = 0; i < paddedMessage.length; i++) {
        const val = paddedMessage.charCodeAt(i);
        for (let j = 0; j < 8; j++) {
            bits.push((val >> (7 - j)) & 1);
        }
    }
    
    // Process 8x8 grid of blocks (each block is 64x64)
    for (let b = 0; b < 64; b++) {
        const bit = bits[b];
        const bx = b % 8;
        const by = Math.floor(b / 8);
        
        // Generate pseudo-random pattern for this block
        const lcg = new LCG(key + b);
        const pattern = new Float32Array(64 * 64);
        for (let i = 0; i < 64 * 64; i++) {
            pattern[i] = lcg.nextFloat() > 0.5 ? 1.0 : -1.0;
        }
        
        // Embed watermark in blue channel (index 2)
        // Skip 1-pixel border of each block for boundary filtering safety
        for (let y = 1; y < 63; y++) {
            for (let x = 1; x < 63; x++) {
                const px = bx * 64 + x;
                const py = by * 64 + y;
                const p = pattern[y * 64 + x];
                const idx = (py * width + px) * 4;
                
                let bVal = data[idx + 2]; // Blue channel
                if (bit === 1) {
                    bVal += alpha * p;
                } else {
                    bVal -= alpha * p;
                }
                
                // Clamp to [0, 255]
                data[idx + 2] = Math.max(0, Math.min(255, bVal));
            }
        }
    }
}

/**
 * Extracts a 64-bit watermark (8 characters) from the blue channel of a 512x512 image.
 * 
 * @param {ImageData} imageData - The canvas ImageData object (must be 512x512).
 * @param {number} key - Watermark secret key (default: 2026).
 * @returns {Object} { decodedString, bits }
 */
function extractWatermark(imageData, key) {
    if (imageData.width !== 512 || imageData.height !== 512) {
        throw new Error("Watermark extraction requires a 512x512 image.");
    }
    
    const width = imageData.width;
    const data = imageData.data;
    const extractedBits = [];
    
    // Process 8x8 grid of blocks
    for (let b = 0; b < 64; b++) {
        const bx = b % 8;
        const by = Math.floor(b / 8);
        
        // Generate the identical pattern
        const lcg = new LCG(key + b);
        const pattern = new Float32Array(64 * 64);
        for (let i = 0; i < 64 * 64; i++) {
            pattern[i] = lcg.nextFloat() > 0.5 ? 1.0 : -1.0;
        }
        
        let sumVal = 0.0;
        
        // Apply high-pass filter (subtract local 3x3 mean) and correlate
        for (let y = 1; y < 63; y++) {
            for (let x = 1; x < 63; x++) {
                const px = bx * 64 + x;
                const py = by * 64 + y;
                
                // Calculate local 3x3 average
                let localSum = 0.0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const idx = ((py + dy) * width + (px + dx)) * 4;
                        localSum += data[idx + 2];
                    }
                }
                const localMean = localSum / 9.0;
                
                const idx = (py * width + px) * 4;
                const hp = data[idx + 2] - localMean; // High-pass value
                const p = pattern[y * 64 + x];
                sumVal += hp * p;
            }
        }
        
        extractedBits.push(sumVal > 0 ? 1 : 0);
    }
    
    // Convert 64 bits to 8 ASCII characters
    const chars = [];
    for (let i = 0; i < 8; i++) {
        let byteVal = 0;
        for (let j = 0; j < 8; j++) {
            byteVal |= (extractedBits[i * 8 + j] << (7 - j));
        }
        // Filter out non-printable ASCII characters for safe display
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
