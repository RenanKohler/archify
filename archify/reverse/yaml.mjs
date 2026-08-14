// Bounded YAML subset parser for the reverse-engineering pipeline.
//
// The reverse pipeline must validate an authored `openapi.yaml` without adding
// a runtime dependency to a skill that ships without `npm install`. This parser
// therefore supports the block subset that OpenAPI documents actually use and
// fails closed on every construct it cannot represent faithfully. A parse error
// is always better than a silently different document.

export class YamlError extends Error {
  constructor(message, line) {
    super(message);
    this.name = 'YamlError';
    this.line = line;
  }
}

const INDICATORS = /^[&*!|>%@`]/;

function fail(message, line) {
  throw new YamlError(message, line);
}

function splitLines(source) {
  return source.replace(/^﻿/, '').split(/\r\n|\n|\r/);
}

function indentWidth(raw) {
  let width = 0;
  for (const character of raw) {
    if (character === ' ') width += 1;
    else break;
  }
  return width;
}

// Strips a trailing comment while respecting quotes and flow collections.
function stripComment(text, line) {
  let quote = null;
  let flow = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === '\\') {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') flow += 1;
    if (character === ']' || character === '}') flow -= 1;
    if (character === '#' && flow === 0 && (index === 0 || /\s/.test(text[index - 1]))) {
      return text.slice(0, index).trimEnd();
    }
  }
  if (quote) fail('unterminated quoted scalar', line);
  return text.trimEnd();
}

function parseDoubleQuoted(text, line) {
  let value = '';
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      const next = text[index + 1];
      const escapes = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', 0: '\0' };
      if (next === 'u') {
        const hex = text.slice(index + 2, index + 6);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('invalid \\u escape in a double-quoted scalar', line);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
      if (!(next in escapes)) fail(`unsupported escape "\\${next}" in a double-quoted scalar`, line);
      value += escapes[next];
      index += 1;
      continue;
    }
    if (character === '"') {
      if (index !== text.length - 1) fail('unexpected content after a double-quoted scalar', line);
      return value;
    }
    value += character;
  }
  return fail('unterminated double-quoted scalar', line);
}

function parseSingleQuoted(text, line) {
  let value = '';
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "'") {
      if (text[index + 1] === "'") {
        value += "'";
        index += 1;
        continue;
      }
      if (index !== text.length - 1) fail('unexpected content after a single-quoted scalar', line);
      return value;
    }
    value += character;
  }
  return fail('unterminated single-quoted scalar', line);
}

// Splits one flow collection body on top-level commas.
function splitFlow(body, line) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quote) {
      current += character;
      if (quote === '"' && character === '\\') {
        current += body[index + 1] ?? '';
        index += 1;
        continue;
      }
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      current += character;
      continue;
    }
    if (character === '[' || character === '{') depth += 1;
    if (character === ']' || character === '}') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  if (quote) fail('unterminated quoted scalar inside a flow collection', line);
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function parseFlow(text, line) {
  if (text.startsWith('[')) {
    if (!text.endsWith(']')) fail('flow sequence must close on the same line', line);
    return splitFlow(text.slice(1, -1), line).map((entry) => parseScalar(entry, line));
  }
  if (!text.endsWith('}')) fail('flow mapping must close on the same line', line);
  const mapping = {};
  for (const entry of splitFlow(text.slice(1, -1), line)) {
    const separator = findKeySeparator(entry);
    if (separator === -1) fail('flow mapping entry requires "key: value"', line);
    const key = String(parseScalar(entry.slice(0, separator).trim(), line));
    mapping[key] = parseScalar(entry.slice(separator + 1).trim(), line);
  }
  return mapping;
}

export function parseScalar(raw, line) {
  const text = raw.trim();
  if (text === '' || text === '~' || text === 'null' || text === 'Null' || text === 'NULL') return null;
  if (text === 'true' || text === 'True' || text === 'TRUE') return true;
  if (text === 'false' || text === 'False' || text === 'FALSE') return false;
  if (text.startsWith('"')) return parseDoubleQuoted(text, line);
  if (text.startsWith("'")) return parseSingleQuoted(text, line);
  if (text.startsWith('[') || text.startsWith('{')) return parseFlow(text, line);
  if (INDICATORS.test(text)) fail(`unsupported YAML construct "${text[0]}"`, line);
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(text)) return Number(text);
  return text;
}

// Returns the index of the ": " (or trailing ":") that separates a block key.
function findKeySeparator(text) {
  let quote = null;
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (quote === '"' && character === '\\') {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (quote === "'" && text[index + 1] === "'") {
          index += 1;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '[' || character === '{') depth += 1;
    if (character === ']' || character === '}') depth -= 1;
    if (character === ':' && depth === 0 && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      return index;
    }
  }
  return -1;
}

function readBlockScalar(lines, cursor, parentIndent, header, line) {
  const fold = header.startsWith('>');
  const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip';
  const collected = [];
  let blockIndent = null;
  let index = cursor;
  while (index < lines.length) {
    const raw = lines[index];
    if (raw.trim() === '') {
      collected.push('');
      index += 1;
      continue;
    }
    const width = indentWidth(raw);
    if (width <= parentIndent) break;
    if (blockIndent === null) blockIndent = width;
    if (width < blockIndent) break;
    collected.push(raw.slice(blockIndent));
    index += 1;
  }
  while (collected.length && collected[collected.length - 1] === '') collected.pop();
  if (blockIndent === null) fail('block scalar requires at least one indented line', line);
  let value;
  if (fold) {
    value = collected.reduce((text, entry, position) => {
      if (position === 0) return entry;
      if (entry === '' || collected[position - 1] === '') return `${text}\n${entry}`;
      return `${text} ${entry}`;
    }, '');
  } else {
    value = collected.join('\n');
  }
  if (chomp === 'clip') value += '\n';
  if (chomp === 'keep') value += '\n';
  return { value, index };
}

function parseNode(lines, cursor, indent) {
  let index = cursor;
  while (index < lines.length && (lines[index].trim() === '' || lines[index].trim().startsWith('#'))) index += 1;
  if (index >= lines.length) return { value: null, index };
  const raw = lines[index];
  const width = indentWidth(raw);
  if (width < indent) return { value: null, index };
  return raw.trim().startsWith('- ') || raw.trim() === '-'
    ? parseSequence(lines, index, width)
    : parseMapping(lines, index, width);
}

function parseSequence(lines, cursor, indent) {
  const items = [];
  let index = cursor;
  while (index < lines.length) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (raw.trim() === '') {
      index += 1;
      continue;
    }
    const width = indentWidth(raw);
    if (width < indent) break;
    const body = stripComment(raw.trim(), lineNumber);
    if (body === '' || body.startsWith('#')) {
      index += 1;
      continue;
    }
    if (width > indent) fail('unexpected indentation inside a block sequence', lineNumber);
    if (!body.startsWith('- ') && body !== '-') fail('block sequence entries must start with "- "', lineNumber);
    const inline = body === '-' ? '' : body.slice(2).trim();
    if (inline === '') {
      const nested = parseNode(lines, index + 1, indent + 1);
      items.push(nested.value);
      index = nested.index;
      continue;
    }
    const separator = findKeySeparator(inline);
    if (separator === -1) {
      if (/^[|>][-+]?$/.test(inline)) {
        const block = readBlockScalar(lines, index + 1, indent, inline, lineNumber);
        items.push(block.value);
        index = block.index;
        continue;
      }
      items.push(parseScalar(inline, lineNumber));
      index += 1;
      continue;
    }
    // "- key: value" opens a mapping whose indentation starts at the dash body.
    const itemIndent = indent + (body.length - body.slice(2).length);
    const rewritten = [...lines];
    rewritten[index] = ' '.repeat(itemIndent) + inline;
    const mapping = parseMapping(rewritten, index, itemIndent);
    items.push(mapping.value);
    index = mapping.index;
  }
  return { value: items, index };
}

function parseMapping(lines, cursor, indent) {
  const mapping = {};
  let index = cursor;
  while (index < lines.length) {
    const raw = lines[index];
    const lineNumber = index + 1;
    if (raw.trim() === '') {
      index += 1;
      continue;
    }
    const width = indentWidth(raw);
    if (width < indent) break;
    const body = stripComment(raw.trim(), lineNumber);
    if (body === '' || body.startsWith('#')) {
      index += 1;
      continue;
    }
    if (width > indent) fail('unexpected indentation inside a block mapping', lineNumber);
    if (body.startsWith('- ')) break;
    const separator = findKeySeparator(body);
    if (separator === -1) fail('block mapping entries require "key: value"', lineNumber);
    const key = String(parseScalar(body.slice(0, separator).trim(), lineNumber));
    if (Object.prototype.hasOwnProperty.call(mapping, key)) {
      fail(`duplicate mapping key "${key}"`, lineNumber);
    }
    const inline = body.slice(separator + 1).trim();
    if (inline === '') {
      const nested = parseNode(lines, index + 1, indent + 1);
      mapping[key] = nested.index === index + 1 ? null : nested.value;
      index = nested.index;
      continue;
    }
    if (/^[|>][-+]?$/.test(inline)) {
      const block = readBlockScalar(lines, index + 1, indent, inline, lineNumber);
      mapping[key] = block.value;
      index = block.index;
      continue;
    }
    mapping[key] = parseScalar(inline, lineNumber);
    index += 1;
  }
  return { value: mapping, index };
}

export function parseYaml(source) {
  const lines = splitLines(source);
  for (const [position, raw] of lines.entries()) {
    if (/^\s*\t/.test(raw)) fail('tabs are not valid YAML indentation', position + 1);
    if (raw.trim() === '...') fail('multi-document YAML is not supported', position + 1);
  }
  let start = 0;
  while (start < lines.length && (lines[start].trim() === '' || lines[start].trim().startsWith('#'))) start += 1;
  if (start < lines.length && lines[start].trim() === '---') start += 1;
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') fail('multi-document YAML is not supported', index + 1);
  }
  const { value } = parseNode(lines, start, 0);
  return value;
}
