import * as vscode from "vscode";

export class PdfImagePanel {
  public static currentPanel: PdfImagePanel | undefined;
  public static panels: PdfImagePanel[] = [];

  private readonly _panel: vscode.WebviewPanel;
  private readonly _context: vscode.ExtensionContext;
  private _disposables: vscode.Disposable[] = [];

  public get isActive(): boolean {
    return this._panel.active;
  }

  public static handleCopyImageCommand(args?: any) {
    // If we have panels, broadcast the copy command to all of them.
    // The webview script will only react if `lastHoveredImageDataUrl` is set,
    // which guarantees only the panel where the user actually right-clicked will copy.
    if (PdfImagePanel.panels.length > 0) {
      PdfImagePanel.panels.forEach((p) => p.triggerCopyImage());
    } else if (PdfImagePanel.currentPanel) {
      PdfImagePanel.currentPanel.triggerCopyImage();
    } else {
      vscode.window.showErrorMessage(
        "No active PDF image panel found to copy from.",
      );
    }
  }

  public static createOrShow(
    context: vscode.ExtensionContext,
    pdfFileName: string,
    pdfDocumentUri: vscode.Uri,
  ) {
    const column = vscode.ViewColumn.One;

    if (PdfImagePanel.currentPanel) {
      PdfImagePanel.currentPanel._panel.reveal(column);
      PdfImagePanel.currentPanel._update(pdfFileName, pdfDocumentUri);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "pdf2img.preview",
      `PDF Images: ${pdfFileName}`,
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(
            context.extensionUri,
            "node_modules",
            "pdfjs-dist",
          ),
          vscode.Uri.joinPath(context.extensionUri, "media"),
        ],
      },
    );

    PdfImagePanel.currentPanel = new PdfImagePanel(panel, context);
    PdfImagePanel.panels.push(PdfImagePanel.currentPanel);
    PdfImagePanel.currentPanel._update(pdfFileName, pdfDocumentUri);
  }

  /**
   * Initialize from an existing WebviewPanel (used by CustomReadonlyEditorProvider)
   */
  public static initFromExistingPanel(
    context: vscode.ExtensionContext,
    panel: vscode.WebviewPanel,
    pdfFileName: string,
    pdfDocumentUri: vscode.Uri,
  ) {
    // Configure the webview panel
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "node_modules", "pdfjs-dist"),
        vscode.Uri.joinPath(context.extensionUri, "media"),
      ],
    };

    const instance = new PdfImagePanel(panel, context);
    PdfImagePanel.currentPanel = instance;
    PdfImagePanel.panels.push(instance);
    instance._update(pdfFileName, pdfDocumentUri);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
  ) {
    this._panel = panel;
    this._context = context;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.command) {
          case "copyImage":
            await this._copyImageToClipboard(message.dataUrl);
            break;
          case "saveImage":
            await this._saveImage(message.dataUrl, message.pageNumber);
            break;
          case "saveAllImages":
            await this._saveAllImages(message.pages);
            break;
          case "info":
            vscode.window.showInformationMessage(message.text);
            break;
          case "error":
            vscode.window.showErrorMessage(message.text);
            break;
        }
      },
      null,
      this._disposables,
    );
  }

  public triggerCopyImage() {
    this._panel.webview.postMessage({ command: "contextCopyImage" });
  }

  private async _copyImageToClipboard(dataUrl: string) {
    try {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");

      const path = require("path");
      const fs = require("fs");
      const { exec } = require("child_process");

      // Ensure global storage exists
      await vscode.workspace.fs.createDirectory(this._context.globalStorageUri);

      const tempFilePath = vscode.Uri.joinPath(
        this._context.globalStorageUri,
        `pdf2img_copy_${Date.now()}.png`,
      ).fsPath;
      fs.writeFileSync(tempFilePath, buffer);

      const command = `osascript -e 'set the clipboard to (read (POSIX file "${tempFilePath}") as JPEG picture)'`;

      exec(command, (error: any, stdout: string, stderr: string) => {
        if (error || stderr) {
          vscode.window.showErrorMessage(
            `Copy failed: ${error?.message || ""} ${stderr || ""}`,
          );
        } else {
          vscode.window.showInformationMessage("✅ Image copied to clipboard!");
        }
        // Clean up the temp file after copying
        setTimeout(() => {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (e) {}
        }, 1500);
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to process image: ${e.message}`);
    }
  }

  private async _saveImage(dataUrl: string, pageNumber: number) {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`page_${pageNumber}.png`),
      filters: { "PNG Images": ["png"] },
    });

    if (uri) {
      const base64Data = dataUrl.replace(/^data:image\/png;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      await vscode.workspace.fs.writeFile(uri, buffer);
      vscode.window.showInformationMessage(`✅ Page ${pageNumber} saved!`);
    }
  }

  private async _saveAllImages(
    pages: { dataUrl: string; pageNumber: number }[],
  ) {
    const folderUri = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: "Select Folder to Save Images",
    });

    if (folderUri && folderUri[0]) {
      const folder = folderUri[0];
      for (const page of pages) {
        const base64Data = page.dataUrl.replace(/^data:image\/png;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const filePath = vscode.Uri.joinPath(
          folder,
          `page_${page.pageNumber}.png`,
        );
        await vscode.workspace.fs.writeFile(filePath, buffer);
      }
      vscode.window.showInformationMessage(
        `✅ All ${pages.length} pages saved to ${folder.path}`,
      );
    }
  }

  private async _update(pdfFileName: string, pdfDocumentUri: vscode.Uri) {
    this._panel.title = `PDF Images: ${pdfFileName}`;
    this._panel.webview.html = this._getHtmlForWebview(
      pdfFileName,
      pdfDocumentUri,
    );

    try {
      const pdfData = await vscode.workspace.fs.readFile(pdfDocumentUri);
      this._panel.webview.postMessage({
        command: "pdfData",
        data: Array.from(pdfData),
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to read PDF file: ${e}`);
    }
  }

  public dispose() {
    if (PdfImagePanel.currentPanel === this) {
      PdfImagePanel.currentPanel = undefined;
    }
    PdfImagePanel.panels = PdfImagePanel.panels.filter((p) => p !== this);

    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private _getHtmlForWebview(
    pdfFileName: string,
    pdfDocumentUri: vscode.Uri,
  ): string {
    const webview = this._panel.webview;
    const nonce = getNonce();

    // Get pdfjs-dist webview URIs
    const pdfjsBuildUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "node_modules",
        "pdfjs-dist",
        "build",
        "pdf.mjs",
      ),
    );
    const pdfjsWorkerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._context.extensionUri,
        "node_modules",
        "pdfjs-dist",
        "build",
        "pdf.worker.mjs",
      ),
    );

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: ${webview.cspSource} blob:; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src blob: ${webview.cspSource}; font-src ${webview.cspSource}; connect-src ${webview.cspSource};">
  <style nonce="${nonce}">
    :root {
      --bg-primary: #0d1117;
      --bg-secondary: #161b22;
      --bg-tertiary: #21262d;
      --bg-card: rgba(22, 27, 34, 0.8);
      --border-color: rgba(48, 54, 61, 0.6);
      --text-primary: #e6edf3;
      --text-secondary: #8b949e;
      --text-muted: #6e7681;
      --accent-gradient: linear-gradient(135deg, #7c3aed, #2563eb, #06b6d4);
      --accent-purple: #7c3aed;
      --accent-blue: #2563eb;
      --accent-cyan: #06b6d4;
      --shadow-glow: 0 0 20px rgba(124, 58, 237, 0.15);
      --shadow-card: 0 8px 32px rgba(0, 0, 0, 0.3);
      --radius: 12px;
      --radius-sm: 8px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      overflow-x: hidden;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0; left: 0; width: 100%; height: 100%;
      background: 
        radial-gradient(ellipse at 20% 0%, rgba(124, 58, 237, 0.08) 0%, transparent 50%),
        radial-gradient(ellipse at 80% 100%, rgba(6, 182, 212, 0.06) 0%, transparent 50%);
      pointer-events: none;
      z-index: -1;
    }

    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(13, 17, 23, 0.85);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid var(--border-color);
      padding: 16px 24px;
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .logo {
      width: 36px; height: 36px;
      background: var(--accent-gradient);
      border-radius: var(--radius-sm);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 700;
      box-shadow: var(--shadow-glow);
    }

    .header-info h1 { font-size: 16px; font-weight: 600; letter-spacing: -0.02em; }
    .header-info .subtitle { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

    .header-actions { display: flex; align-items: center; gap: 8px; }

    .btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 8px 16px;
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background: var(--bg-tertiary);
      color: var(--text-primary);
      font-size: 13px; font-weight: 500;
      cursor: pointer; transition: all 0.2s ease; white-space: nowrap;
    }
    .btn:hover {
      background: rgba(124, 58, 237, 0.15);
      border-color: var(--accent-purple);
      box-shadow: var(--shadow-glow);
    }
    .btn-primary {
      background: var(--accent-gradient); border: none; color: white;
    }
    .btn-primary:hover {
      opacity: 0.9;
      box-shadow: 0 0 25px rgba(124, 58, 237, 0.3);
    }

    .icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 32px; height: 32px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--text-secondary);
      cursor: pointer; transition: all 0.2s ease;
    }
    .icon-btn:hover {
      background: var(--bg-tertiary);
      color: var(--text-primary);
      border-color: var(--border-color);
    }

    .zoom-control {
      display: flex; align-items: center; gap: 8px;
      padding: 4px 12px;
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
    }
    .zoom-control label {
      font-size: 12px; color: var(--text-secondary); font-weight: 500;
    }
    .zoom-control input[type="range"] {
      width: 100px; height: 4px;
      appearance: none; -webkit-appearance: none;
      background: var(--bg-secondary); border-radius: 2px; outline: none;
    }
    .zoom-control input[type="range"]::-webkit-slider-thumb {
      appearance: none; -webkit-appearance: none;
      width: 14px; height: 14px; border-radius: 50%;
      background: var(--accent-purple); cursor: pointer;
      box-shadow: 0 0 6px rgba(124, 58, 237, 0.4);
    }
    .zoom-value {
      font-size: 12px; color: var(--text-primary);
      font-weight: 600; min-width: 36px; text-align: center;
    }

    .grid-container {
      max-width: 1400px;
      margin: 24px auto;
      padding: 0 24px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(var(--card-width, 500px), 1fr));
      gap: 20px;
    }

    .image-card {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      overflow: hidden;
      transition: all 0.3s ease;
      animation: fadeInUp 0.5s ease both;
    }
    .image-card:hover {
      border-color: rgba(124, 58, 237, 0.4);
      box-shadow: var(--shadow-card), var(--shadow-glow);
      transform: translateY(-2px);
    }

    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border-color);
      background: rgba(13, 17, 23, 0.5);
    }

    .page-badge {
      font-size: 12px; font-weight: 600;
      color: var(--accent-cyan);
      background: rgba(6, 182, 212, 0.1);
      padding: 3px 10px; border-radius: 20px;
      border: 1px solid rgba(6, 182, 212, 0.2);
    }

    .card-actions { display: flex; gap: 4px; }

    .image-wrapper {
      padding: 8px;
      display: flex; justify-content: center; align-items: center;
      background: rgba(255, 255, 255, 0.02);
    }
    .image-wrapper canvas, .image-wrapper img {
      width: 100%; height: auto; display: block;
      border-radius: 6px;
    }

    .page-nav {
      position: fixed; right: 20px; top: 50%;
      transform: translateY(-50%);
      display: flex; flex-direction: column; gap: 4px;
      z-index: 50;
      background: rgba(13, 17, 23, 0.9);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border-color);
      border-radius: var(--radius);
      padding: 8px;
      max-height: 60vh;
      overflow-y: auto;
    }
    .page-nav::-webkit-scrollbar { width: 3px; }
    .page-nav::-webkit-scrollbar-thumb { background: var(--text-muted); border-radius: 3px; }

    .page-dot {
      width: 28px; height: 28px;
      border: none; border-radius: 6px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 11px; font-weight: 600;
      cursor: pointer; transition: all 0.2s ease;
      display: flex; align-items: center; justify-content: center;
    }
    .page-dot:hover { background: var(--bg-tertiary); color: var(--text-primary); }
    .page-dot.active { background: var(--accent-purple); color: white; }

    .context-hint {
      text-align: center; padding: 12px 24px;
      color: var(--text-muted); font-size: 12px;
      border-top: 1px solid var(--border-color);
      background: rgba(13, 17, 23, 0.5);
    }
    .context-hint kbd {
      display: inline-block; padding: 2px 6px;
      background: var(--bg-tertiary); border: 1px solid var(--border-color);
      border-radius: 4px; font-family: inherit; font-size: 11px;
      color: var(--text-secondary);
    }

    /* Loading */
    .loading-container {
      display: flex; flex-direction: column;
      align-items: center; justify-content: center;
      min-height: 60vh; gap: 20px;
    }
    .spinner {
      width: 48px; height: 48px;
      border: 3px solid var(--border-color);
      border-top-color: var(--accent-purple);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    .loading-text { color: var(--text-secondary); font-size: 14px; }
    .progress-bar-container {
      width: 300px; height: 6px;
      background: var(--bg-tertiary);
      border-radius: 3px; overflow: hidden;
    }
    .progress-bar {
      height: 100%; width: 0%;
      background: var(--accent-gradient);
      border-radius: 3px;
      transition: width 0.3s ease;
    }

    .toast {
      position: fixed; bottom: 24px; left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: rgba(22, 27, 34, 0.95);
      border: 1px solid var(--border-color);
      backdrop-filter: blur(12px);
      color: var(--text-primary);
      padding: 12px 24px;
      border-radius: var(--radius);
      font-size: 13px; font-weight: 500;
      z-index: 1000;
      transition: transform 0.3s ease;
      box-shadow: var(--shadow-card);
    }
    .toast.show { transform: translateX(-50%) translateY(0); }

    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: var(--bg-primary); }
    ::-webkit-scrollbar-thumb { background: var(--bg-tertiary); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }

    @media (max-width: 600px) {
      .grid-container { grid-template-columns: 1fr; padding: 0 12px; }
      .page-nav { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-content">
      <div class="header-left">
        <div class="logo">📄</div>
        <div class="header-info">
          <h1>${pdfFileName}</h1>
          <div class="subtitle" id="pageCount">Loading PDF...</div>
        </div>
      </div>
      <div class="header-actions" id="headerActions" style="display:none;">
        <div class="zoom-control">
          <label>Zoom</label>
          <input type="range" id="zoomSlider" min="200" max="900" value="500" step="50" />
          <span class="zoom-value" id="zoomValue">500px</span>
        </div>
        <button class="btn btn-primary" id="saveAllBtn">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 12l-4-4h2.5V3h3v5H12L8 12zM2 14h12v1H2v-1z"/></svg>
          Save All
        </button>
      </div>
    </div>
  </div>

  <div class="context-hint" id="contextHint" style="display:none;">
    💡 <kbd>Right-click</kbd> on any image to <strong>Copy Image</strong> to clipboard
  </div>

  <div id="loadingContainer" class="loading-container">
    <div class="spinner"></div>
    <div class="loading-text" id="loadingText">Rendering PDF pages...</div>
    <div class="progress-bar-container">
      <div class="progress-bar" id="progressBar"></div>
    </div>
  </div>

  <div class="grid-container" id="imageGrid" style="display:none;"></div>
  <div id="pageNavContainer"></div>
  <div class="toast" id="toast"></div>

  <script type="importmap" nonce="${nonce}">
    { "imports": { "pdfjs": "${pdfjsBuildUri}" } }
  </script>
  <script nonce="${nonce}" type="module">
    import * as pdfjsLib from 'pdfjs';
    const vscode = acquireVsCodeApi();

    // Set worker source
    pdfjsLib.GlobalWorkerOptions.workerSrc = '${pdfjsWorkerUri}';

    const renderedPages = []; // { pageNumber, dataUrl }
    let lastHoveredImageDataUrl = null;

    function createSvgIcon(pathD) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('width', '16');
      svg.setAttribute('height', '16');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('fill', 'currentColor');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', pathD);
      svg.appendChild(p);
      return svg;
    }

    async function renderPdf() {
      try {
        window.addEventListener('unhandledrejection', function(event) {
          const errContainer = document.getElementById('loadingContainer');
          errContainer.textContent = '';
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'color:#f85149;font-size:16px;';
          errDiv.textContent = 'Unhandled Promise Rejection: ' + (event.reason && event.reason.message ? event.reason.message : event.reason);
          errContainer.appendChild(errDiv);
          vscode.postMessage({ command: 'error', text: 'Unhandled Rejection: ' + event.reason });
        });

        window.addEventListener('error', function(event) {
          const errContainer = document.getElementById('loadingContainer');
          errContainer.textContent = '';
          const errDiv = document.createElement('div');
          errDiv.style.cssText = 'color:#f85149;font-size:16px;';
          errDiv.textContent = 'Window Error: ' + event.message;
          errContainer.appendChild(errDiv);
          vscode.postMessage({ command: 'error', text: 'Window Error: ' + event.message });
        });

        document.getElementById('loadingText').textContent = 'Loading PDF worker...';
        
        try {
          const workerRes = await fetch('${pdfjsWorkerUri}');
          const workerText = await workerRes.text();
          const workerBlob = new Blob([workerText], { type: 'text/javascript' });
          const workerUrl = URL.createObjectURL(workerBlob);
          pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
        } catch (e) {
          vscode.postMessage({ command: 'error', text: 'Worker fetch error: ' + e });
        }
        
        document.getElementById('loadingText').textContent = 'Waiting for PDF data...';
      } catch (err) {
        showError(err);
      }
    }

    function showError(err) {
      const errContainer = document.getElementById('loadingContainer');
      errContainer.textContent = '';
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'color:#f85149;font-size:16px;';
      errDiv.textContent = 'Failed to render PDF: ' + (err.message || err);
      errContainer.appendChild(errDiv);
      vscode.postMessage({ command: 'error', text: 'Failed to render PDF: ' + (err.message || err) });
    }

    async function processPdfData(pdfDataArray) {
      try {
        document.getElementById('loadingText').textContent = 'Loading getDocument...';
        const uint8Array = new Uint8Array(pdfDataArray);
        const task = pdfjsLib.getDocument({ data: uint8Array, standardFontDataUrl: '${webview.asWebviewUri(vscode.Uri.joinPath(this._context.extensionUri, "node_modules", "pdfjs-dist", "standard_fonts"))}/' });
        const pdf = await task.promise;
        const numPages = pdf.numPages;

        document.getElementById('pageCount').textContent = numPages + ' page' + (numPages !== 1 ? 's' : '') + ' converted';
        document.getElementById('loadingText').textContent = 'Rendering page 1 of ' + numPages + '...';

        const grid = document.getElementById('imageGrid');

        for (let i = 1; i <= numPages; i++) {
          document.getElementById('loadingText').textContent = 'Rendering page ' + i + ' of ' + numPages + '...';
          document.getElementById('progressBar').style.width = ((i / numPages) * 100) + '%';

          const page = await pdf.getPage(i);
          const scale = 2.0;
          const viewport = page.getViewport({ scale });

          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          const ctx = canvas.getContext('2d');

          await page.render({ canvasContext: ctx, viewport }).promise;

          const dataUrl = canvas.toDataURL('image/png');
          renderedPages.push({ pageNumber: i, dataUrl });

          // Create card
          const card = document.createElement('div');
          card.className = 'image-card';
          card.id = 'page-' + i;
          card.style.animationDelay = (i * 0.05) + 's';
          // Build card header
          const cardHeader = document.createElement('div');
          cardHeader.className = 'card-header';
          const pageBadge = document.createElement('span');
          pageBadge.className = 'page-badge';
          pageBadge.textContent = 'Page ' + i;
          const cardActions = document.createElement('div');
          cardActions.className = 'card-actions';
          const saveBtn = document.createElement('button');
          saveBtn.className = 'icon-btn';
          saveBtn.setAttribute('data-action', 'save');
          saveBtn.setAttribute('data-page', String(i));
          saveBtn.title = 'Save Image';
          saveBtn.appendChild(createSvgIcon('M8 12l-4-4h2.5V3h3v5H12L8 12zM2 14h12v1H2v-1z'));
          const copyBtn = document.createElement('button');
          copyBtn.className = 'icon-btn';
          copyBtn.setAttribute('data-action', 'copy');
          copyBtn.setAttribute('data-page', String(i));
          copyBtn.title = 'Copy Image';
          copyBtn.appendChild(createSvgIcon('M4 4l1-1h6l1 1v6l-1 1H5l-1-1V4zm-2 2l1-1v8l1 1h8l1 1H3l-1-1V6z'));
          cardActions.appendChild(saveBtn);
          cardActions.appendChild(copyBtn);
          cardHeader.appendChild(pageBadge);
          cardHeader.appendChild(cardActions);
          // Build image wrapper
          const imgWrapper = document.createElement('div');
          imgWrapper.className = 'image-wrapper';
          imgWrapper.setAttribute('data-vscode-context', JSON.stringify({webviewSection: 'image', pageNumber: i, preventDefaultContextMenuItems: true}));
          const img = document.createElement('img');
          img.src = dataUrl;
          img.alt = 'Page ' + i;
          imgWrapper.appendChild(img);
          card.appendChild(cardHeader);
          card.appendChild(imgWrapper);

          // Attach event listeners (CSP blocks inline onclick)
          card.querySelector('[data-action="save"]').addEventListener('click', () => saveImage(i));
          card.querySelector('[data-action="copy"]').addEventListener('click', () => copyImg(i));

          // Track hover for context menu
          const hoverWrapper = card.querySelector('.image-wrapper');
          hoverWrapper.addEventListener('mouseenter', () => {
            lastHoveredImageDataUrl = dataUrl;
          });

          grid.appendChild(card);
        }

        // Show grid, hide loading
        document.getElementById('loadingContainer').style.display = 'none';
        grid.style.display = 'grid';
        document.getElementById('headerActions').style.display = 'flex';
        document.getElementById('contextHint').style.display = 'block';

        // Build page nav
        if (numPages > 3) {
          const navContainer = document.getElementById('pageNavContainer');
          const navDiv = document.createElement('div');
          navDiv.className = 'page-nav';
          navDiv.id = 'pageNav';
          for (let i = 1; i <= numPages; i++) {
            const dot = document.createElement('button');
            dot.className = 'page-dot';
            dot.setAttribute('data-page', String(i));
            dot.title = 'Page ' + i;
            dot.textContent = String(i);
            dot.addEventListener('click', () => scrollToPage(i));
            navDiv.appendChild(dot);
          }
          navContainer.appendChild(navDiv);

          // Intersection observer
          const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
              if (entry.isIntersecting) {
                const num = parseInt(entry.target.id.replace('page-', ''));
                updateActivePageDot(num);
              }
            });
          }, { threshold: 0.5 });
          document.querySelectorAll('.image-card').forEach(card => observer.observe(card));
        }

      } catch (err) {
        const errContainer = document.getElementById('loadingContainer');
        errContainer.textContent = '';
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'color:#f85149;font-size:16px;';
        errDiv.textContent = 'Failed to render PDF: ' + (err.message || err);
        errContainer.appendChild(errDiv);
        vscode.postMessage({ command: 'error', text: 'Failed to render PDF: ' + (err.message || err) });
      }
    }

    // Functions (scoped to module, accessed via addEventListener — no inline onclick needed)
    function scrollToPage(num) {
      const el = document.getElementById('page-' + num);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.boxShadow = '0 0 0 2px var(--accent-purple), var(--shadow-card)';
        setTimeout(() => { el.style.boxShadow = ''; }, 1500);
      }
      updateActivePageDot(num);
    }

    function updateActivePageDot(num) {
      document.querySelectorAll('.page-dot').forEach(dot => dot.classList.remove('active'));
      const dots = document.querySelectorAll('.page-dot');
      if (dots[num - 1]) dots[num - 1].classList.add('active');
    }

    async function copyImg(pageNum) {
      const page = renderedPages.find(p => p.pageNumber === pageNum);
      if (!page) return;

      showToast('Copying image...');

      // Send to extension host for clipboard handling
      vscode.postMessage({ command: 'copyImage', dataUrl: page.dataUrl });
    }

    function saveImage(pageNum) {
      const page = renderedPages.find(p => p.pageNumber === pageNum);
      if (page) {
        vscode.postMessage({ command: 'saveImage', dataUrl: page.dataUrl, pageNumber: pageNum });
      }
    }

    function saveAll() {
      vscode.postMessage({ command: 'saveAllImages', pages: renderedPages });
    }

    // Attach Save All button listener
    document.getElementById('saveAllBtn').addEventListener('click', saveAll);

    function showToast(msg) {
      const toast = document.getElementById('toast');
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 2500);
    }

    // Zoom control
    const slider = document.getElementById('zoomSlider');
    const zoomValue = document.getElementById('zoomValue');
    slider.addEventListener('input', (e) => {
      const val = e.target.value;
      zoomValue.textContent = val + 'px';
      document.getElementById('imageGrid').style.setProperty('--card-width', val + 'px');
    });

    // Handle context menu copy and raw data loading from extension
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.command === 'contextCopyImage' && lastHoveredImageDataUrl) {
        vscode.postMessage({ command: 'copyImage', dataUrl: lastHoveredImageDataUrl });
        showToast('Copying image to clipboard...');
      } else if (message.command === 'pdfData') {
        processPdfData(message.data);
      }
    });

    // Start rendering (initializes worker and waits for data)
    renderPdf();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
