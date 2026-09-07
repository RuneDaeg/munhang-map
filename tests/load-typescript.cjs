/* oxlint-disable typescript/no-require-imports */
const fs = require('node:fs');
const ts = require('typescript');

// Only used by Node regression tests; the application keeps its Vite build.
const load = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
  module._compile(output.outputText, filename);
};
require.extensions['.ts'] = load;
require.extensions['.tsx'] = load;
