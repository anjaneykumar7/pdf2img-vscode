import * as vscode from "vscode";
import { PdfImagePanel } from "./webviewPanel";

class PdfEditorProvider implements vscode.CustomReadonlyEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  async openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CustomDocument> {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    const pdfFileName = document.uri.path.split("/").pop() || "document.pdf";

    try {
      PdfImagePanel.initFromExistingPanel(
        this.context,
        webviewPanel,
        pdfFileName,
        document.uri,
      );
    } catch (error: any) {
      vscode.window.showErrorMessage(
        `Failed to open PDF: ${error.message || error}`,
      );
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("PDF to Images extension activated");

  // Register custom editor for .pdf files
  const editorProvider = new PdfEditorProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      "pdf2img.pdfPreview",
      editorProvider,
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      },
    ),
  );

  // Register the manual convert command (file picker / right-click)
  const convertCommand = vscode.commands.registerCommand(
    "pdf2img.convertPdf",
    async (uri?: vscode.Uri) => {
      let pdfUri = uri;

      if (!pdfUri) {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { "PDF Files": ["pdf"] },
          openLabel: "Select PDF to Convert",
        });

        if (!selected || selected.length === 0) {
          return;
        }
        pdfUri = selected[0];
      }

      const pdfFileName = pdfUri.path.split("/").pop() || "document.pdf";

      try {
        PdfImagePanel.createOrShow(context, pdfFileName, pdfUri);
      } catch (error: any) {
        vscode.window.showErrorMessage(
          `Failed to open PDF: ${error.message || error}`,
        );
      }
    },
  );

  // Register the copy image context menu command
  const copyImageCommand = vscode.commands.registerCommand(
    "pdf2img.copyImage",
    async (args?: any) => {
      PdfImagePanel.handleCopyImageCommand(args);
    },
  );

  context.subscriptions.push(convertCommand, copyImageCommand);
}

export function deactivate() {
  // Clean up
}
