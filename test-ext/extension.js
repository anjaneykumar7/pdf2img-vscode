const vscode = require('vscode');
function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('test.hello', () => {
      vscode.window.showInformationMessage('Hello!');
    })
  );
}
module.exports = { activate };
