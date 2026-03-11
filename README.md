# PDF to Images

Convert PDF files to high-quality images directly within Visual Studio Code! This extension provides a custom PDF viewer that renders PDF pages as images and allows you to easily save or copy them.

## Features

- **Custom Editor for PDFs:** Click on any `.pdf` file in the explorer to open it in a beautiful, dark-themed image gallery viewer.
- **Copy Images:** Right-click on any page image and select "Copy Image" to quickly copy it to your clipboard.
- **Save Images:** Save individual pages as PNG images to your local file system.
- **Save All:** Export all pages of a PDF to a selected folder in one click.
- **Zoom Controls:** Easily zoom in and out of the PDF pages using the built-in slider.
- **Page Navigation:** Quickly jump to specific pages using the dot navigation menu.

## Usage

1. Open a workspace containing `.pdf` files.
2. Click on a `.pdf` file in the Explorer. It will open in the custom "PDF to Images" viewer.
3. Wait for the pages to render.
4. **Context Menu:** You can also right-click a `.pdf` file and select "PDF to Images: Convert PDF".
5. **Right-Click inside Viewer:** Right-click any rendered page and select "Copy Image" to copy the image data or use the Save buttons on the cards.

## Requirements

- Visual Studio Code v1.85.0 or later.

## Release Notes

### 1.0.0

- Initial release of PDF to Images.
- Implemented PDF to image rendering using PDF.js.
- Added copy and save functionality for individual and multiple pages.
