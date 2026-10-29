import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const files = fs.readdirSync('src').filter((name) => /\.(tsx|ts)$/.test(name));
let imports = 0;
for (const name of files) {
  const source = fs.readFileSync(path.join('src', name), 'utf8');
  assert.ok(!/@mantine\//.test(source), `${name}: legacy component library`);
  assert.ok(
    !/<(?:button|input|select|textarea|table|dialog|aside|nav)\b/.test(source),
    `${name}: use the shared OneUI control`,
  );
  assert.ok(
    !/<Box[^>]*>\s*<Table\.(?:Th|Td)/.test(source),
    `${name}: invalid table wrapper`,
  );
  imports += (source.match(/from ['"]@robert-stackflow\/oneui\//g) || [])
    .length;
}
const css = fs
  .readFileSync('src/styles.css', 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');
assert.ok(
  !/(?:^|[;{])\s*(?:color|background(?:-\w+)?|border(?:-\w+)?|box-shadow|font(?:-\w+)?|letter-spacing|opacity|transition|animation)\s*:/.test(
    css,
  ),
  'Application CSS must only arrange layout.',
);
assert.ok(
  !/#[\da-f]{3,8}\b|--(?:accent|surface|canvas|muted)\s*:/i.test(css),
  'Do not copy theme tokens.',
);
console.log(
  JSON.stringify({
    passed: true,
    sourceFiles: files.length,
    oneuiImports: imports,
    applicationStyles: 'layout only',
  }),
);
