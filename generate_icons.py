import os
from PIL import Image, ImageDraw

def create_icon(size):
    # Create an image with transparent background
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Coordinates for drawing
    padding = max(1, size // 10)
    box = [padding, padding, size - padding, size - padding]
    
    # Draw a tech-themed circular gradient-like shape
    # Outer circle (shield-like glowing border)
    for i in range(max(1, size // 12)):
        offset = i
        color = (34, 197, 94, 255) # Sleek green glow
        if i > 0:
            color = (34, 197, 94, int(255 * (1 - i / (size // 12))))
        draw.ellipse([box[0] + offset, box[1] + offset, box[2] - offset, box[3] - offset], outline=color)
        
    # Inner circular badge
    inner_padding = padding + max(1, size // 8)
    inner_box = [inner_padding, inner_padding, size - inner_padding, size - inner_padding]
    
    # Draw dark tech theme background
    draw.ellipse(inner_box, fill=(15, 23, 42, 255)) # Slate 900
    
    # Draw scanner radar lines/dots
    center = size // 2
    
    # Draw "C" (for Captcha Detector) in the center or a stylized radar sweep
    if size >= 32:
        # Drawing a nice puzzle piece / radar shape
        # Let's draw an inner circle that represents a scan circle
        radar_padding = inner_padding + max(1, size // 10)
        draw.ellipse([radar_padding, radar_padding, size - radar_padding, size - radar_padding], outline=(59, 130, 246, 255)) # Blue-500
        
        # Scanner sweep line
        draw.line([center, center, size - inner_padding, center], fill=(59, 130, 246, 180), width=max(1, size // 24))
        
        # Center glowing pulse dot
        dot_r = max(2, size // 12)
        draw.ellipse([center - dot_r, center - dot_r, center + dot_r, center + dot_r], fill=(34, 197, 94, 255))
    else:
        # Small icon: just a simple green glowing dot in the center
        draw.ellipse([center - 2, center - 2, center + 2, center + 2], fill=(34, 197, 94, 255))

    return img

def main():
    os.makedirs("icons", exist_ok=True)
    sizes = [16, 32, 48, 128]
    for size in sizes:
        img = create_icon(size)
        img.save(f"icons/icon{size}.png")
        print(f"Generated icons/icon{size}.png")

if __name__ == "__main__":
    main()
