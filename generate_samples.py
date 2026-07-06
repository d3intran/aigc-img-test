import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

class LCG:
    def __init__(self, seed):
        self.state = seed
    def next_float(self):
        self.state = (1103515245 * self.state + 12345) % 2147483648
        return self.state / 2147483648

def embed_watermark(image_path, output_path, key=2026, message="AIGC-OK!", alpha=15):
    # Load image and resize to 512x512
    img = Image.open(image_path).convert('RGB').resize((512, 512))
    pixels = np.array(img, dtype=np.float32)
    
    # Message to bits (64 bits for 8 chars)
    message = message[:8].ljust(8, ' ')
    bits = []
    for char in message:
        val = ord(char)
        for i in range(8):
            bits.append((val >> (7 - i)) & 1)
            
    # Grid of 8x8 blocks, each block is 64x64
    for b in range(64):
        bit = bits[b]
        bx = b % 8
        by = b // 8
        
        # Generate random pattern for this block using LCG
        lcg = LCG(key + b)
        pattern = np.zeros((64, 64), dtype=np.float32)
        for y in range(64):
            for x in range(64):
                val = lcg.next_float()
                pattern[y, x] = 1.0 if val > 0.5 else -1.0
        
        # Embed in blue channel (index 2)
        # Skip 1-pixel border to match extraction high-pass filter
        for y in range(1, 63):
            for x in range(1, 63):
                px = bx * 64 + x
                py = by * 64 + y
                p = pattern[y, x]
                if bit == 1:
                    pixels[py, px, 2] += alpha * p
                else:
                    pixels[py, px, 2] -= alpha * p
                    
    # Clip and save
    pixels = np.clip(pixels, 0, 255).astype(np.uint8)
    watermarked_img = Image.fromarray(pixels)
    
    # Add EXIF metadata
    exif = watermarked_img.getexif()
    # Tag 271: Make, Tag 272: Model, Tag 37510: UserComment (0x9286)
    exif[271] = "AIGC"
    exif[272] = "StableDiffusion_v2"
    exif[37510] = b"ASCII\x00\x00\x00AIGC_Implicit_Watermarked_Identifier"
    
    watermarked_img.save(output_path, "JPEG", quality=95, exif=exif)
    print(f"[+] Successfully generated implicit marked image: {output_path}")

def generate_explicit_image(image_path, output_path):
    img = Image.open(image_path).convert('RGB').resize((512, 512))
    draw = ImageDraw.Draw(img)
    
    # Draw a semi-transparent banner in the bottom-right corner
    # Width: 180, Height: 40
    # X: 512 - 180 - 10 = 322, Y: 512 - 40 - 10 = 462
    banner_box = [322, 462, 502, 502]
    
    # Create an overlay for transparency
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    overlay_draw = ImageDraw.Draw(overlay)
    # Draw dark rounded rectangle with 60% opacity (153/255)
    overlay_draw.rounded_rectangle(banner_box, radius=8, fill=(0, 0, 0, 153))
    
    # Combine original image with overlay
    img = Image.alpha_composite(img.convert('RGBA'), overlay).convert('RGB')
    
    # Draw text
    draw = ImageDraw.Draw(img)
    # Fallback to default font if custom font doesn't exist
    font_size = 14
    try:
        # Try loading a standard system font for Windows
        font = ImageFont.truetype("msyh.ttc", font_size) # Microsoft YaHei
    except:
        try:
            font = ImageFont.truetype("arial.ttf", font_size)
        except:
            font = ImageFont.load_default()
            
    # Text content
    text = "AI生成 / AIGC"
    # Draw text centered in the banner
    draw.text((345, 472), text, fill=(255, 255, 255), font=font)
    
    img.save(output_path, "JPEG", quality=95)
    print(f"[+] Successfully generated explicit marked image: {output_path}")

def generate_clean_image(image_path, output_path):
    img = Image.open(image_path).convert('RGB').resize((512, 512))
    img.save(output_path, "JPEG", quality=95)
    print(f"[+] Successfully generated clean image: {output_path}")

if __name__ == "__main__":
    base_img = "aigc_scenery.jpg"
    if not os.path.exists(base_img):
        print(f"[-] Error: Base image {base_img} not found!")
    else:
        generate_clean_image(base_img, "sample1_clean.jpg")
        generate_explicit_image(base_img, "sample2_explicit.jpg")
        embed_watermark(base_img, "sample3_implicit.jpg")
        print("[+] All samples generated successfully!")
