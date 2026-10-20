/*
 * PyMini: the small Python interpreter behind Life.py.
 *
 * It runs the beginner subset of Python 3 the game teaches: numbers, strings and
 * f-strings, lists, variables, maths, comparisons, if/elif/else, for and while.
 * Mistakes are reported with the same wording CPython 3.13 uses, so players get
 * used to real error messages. Valid Python the game doesn't teach yet raises
 * Unsupported instead of guessing.
 *
 * Exposes window.PyMini = { run, explain, parse }.
 */
(function (root) {
  'use strict';

  // ---------- errors ----------

  class PyError extends Error {
    constructor(type, message, line) {
      super(type + ': ' + message);
      this.type = type;
      this.pyMessage = message;
      this.line = line || null;
    }
  }

  class Unsupported extends Error {
    constructor(what, line) {
      super('Unsupported: ' + what);
      this.what = what;
      this.line = line || null;
    }
  }

  class TooLong extends Error {
    constructor(line) {
      super('Program ran too long');
      this.line = line || null;
    }
  }

  const BREAK = { signal: 'break' };
  const CONTINUE = { signal: 'continue' };

  const syntaxError = (msg, line) => new PyError('SyntaxError', msg, line);
  const indentError = (msg, line) => new PyError('IndentationError', msg, line);
  const typeError = (msg) => new PyError('TypeError', msg);
  const valueError = (msg) => new PyError('ValueError', msg);

  // ---------- names CPython knows about (used for "Did you mean" suggestions) ----------

  const BUILTIN_NAMES = ['ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException', 'BaseExceptionGroup', 'BlockingIOError', 'BrokenPipeError', 'BufferError', 'BytesWarning', 'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError', 'ConnectionRefusedError', 'ConnectionResetError', 'DeprecationWarning', 'EOFError', 'Ellipsis', 'EncodingWarning', 'EnvironmentError', 'Exception', 'ExceptionGroup', 'False', 'FileExistsError', 'FileNotFoundError', 'FloatingPointError', 'FutureWarning', 'GeneratorExit', 'IOError', 'ImportError', 'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError', 'IsADirectoryError', 'KeyError', 'KeyboardInterrupt', 'LookupError', 'MemoryError', 'ModuleNotFoundError', 'NameError', 'None', 'NotADirectoryError', 'NotImplemented', 'NotImplementedError', 'OSError', 'OverflowError', 'PendingDeprecationWarning', 'PermissionError', 'ProcessLookupError', 'PythonFinalizationError', 'RecursionError', 'ReferenceError', 'ResourceWarning', 'RuntimeError', 'RuntimeWarning', 'StopAsyncIteration', 'StopIteration', 'SyntaxError', 'SyntaxWarning', 'SystemError', 'SystemExit', 'TabError', 'TimeoutError', 'True', 'TypeError', 'UnboundLocalError', 'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError', 'UnicodeWarning', 'UserWarning', 'ValueError', 'Warning', 'ZeroDivisionError', '_IncompleteInputError', '__build_class__', '__debug__', '__doc__', '__import__', '__loader__', '__name__', '__package__', '__spec__', 'abs', 'aiter', 'all', 'anext', 'any', 'ascii', 'bin', 'bool', 'breakpoint', 'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex', 'copyright', 'credits', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval', 'exec', 'exit', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals', 'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance', 'issubclass', 'iter', 'len', 'license', 'list', 'locals', 'map', 'max', 'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print', 'property', 'quit', 'range', 'repr', 'reversed', 'round', 'set', 'setattr', 'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type', 'vars', 'zip'];
  const MODULE_DUNDERS = ['__name__', '__doc__', '__package__', '__loader__', '__spec__', '__annotations__', '__builtins__', '__file__', '__cached__'];
  const STR_ATTRS = ['capitalize', 'casefold', 'center', 'count', 'encode', 'endswith', 'expandtabs', 'find', 'format', 'format_map', 'index', 'isalnum', 'isalpha', 'isascii', 'isdecimal', 'isdigit', 'isidentifier', 'islower', 'isnumeric', 'isprintable', 'isspace', 'istitle', 'isupper', 'join', 'ljust', 'lower', 'lstrip', 'maketrans', 'partition', 'removeprefix', 'removesuffix', 'replace', 'rfind', 'rindex', 'rjust', 'rpartition', 'rsplit', 'rstrip', 'split', 'splitlines', 'startswith', 'strip', 'swapcase', 'title', 'translate', 'upper', 'zfill'];
  const LIST_ATTRS = ['append', 'clear', 'copy', 'count', 'extend', 'index', 'insert', 'pop', 'remove', 'reverse', 'sort'];
  const INT_ATTRS = ['as_integer_ratio', 'bit_count', 'bit_length', 'conjugate', 'denominator', 'from_bytes', 'imag', 'is_integer', 'numerator', 'real', 'to_bytes'];
  const FLOAT_ATTRS = ['as_integer_ratio', 'conjugate', 'fromhex', 'hex', 'imag', 'is_integer', 'real'];
  const STDLIB_MODULES = new Set(['abc', 'argparse', 'array', 'ast', 'asyncio', 'base64', 'bisect', 'builtins', 'calendar', 'cmath', 'codecs', 'collections', 'contextlib', 'copy', 'csv', 'dataclasses', 'datetime', 'decimal', 'dis', 'email', 'enum', 'fractions', 'functools', 'gc', 'getpass', 'glob', 'gzip', 'hashlib', 'heapq', 'html', 'http', 'inspect', 'io', 'itertools', 'json', 'keyword', 'locale', 'logging', 'math', 'numbers', 'operator', 'os', 'pathlib', 'pickle', 'platform', 'pprint', 'queue', 'random', 're', 'secrets', 'select', 'shutil', 'signal', 'site', 'socket', 'sqlite3', 'ssl', 'stat', 'statistics', 'string', 'struct', 'subprocess', 'sys', 'tarfile', 'tempfile', 'textwrap', 'this', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize', 'traceback', 'turtle', 'types', 'typing', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave', 'weakref', 'webbrowser', 'xml', 'zipfile', 'zlib']);

  // CPython's suggestion algorithm (Lib/traceback.py, 3.13).
  function substitutionCost(a, b) {
    if (a === b) return 0;
    if (a.toLowerCase() === b.toLowerCase()) return 1;
    return 2;
  }

  function levenshtein(a, b, maxCost) {
    if (a === b) return 0;
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    a = a.slice(pre);
    b = b.slice(pre);
    let post = 0;
    while (post < a.length && post < b.length && a[a.length - 1 - post] === b[b.length - 1 - post]) post++;
    a = a.slice(0, a.length - post);
    b = b.slice(0, b.length - post);
    if (!a.length || !b.length) return 2 * (a.length + b.length);
    if (a.length > 40 || b.length > 40) return maxCost + 1;
    if (b.length < a.length) [a, b] = [b, a];
    if ((b.length - a.length) * 2 > maxCost) return maxCost + 1;
    const row = [];
    for (let k = 1; k <= a.length; k++) row.push(2 * k);
    let result = 0;
    for (let bi = 0; bi < b.length; bi++) {
      let distance = result = bi * 2;
      let minimum = Infinity;
      for (let ai = 0; ai < a.length; ai++) {
        const substitute = distance + substitutionCost(b[bi], a[ai]);
        distance = row[ai];
        const insertDelete = Math.min(result, distance) + 2;
        result = Math.min(insertDelete, substitute);
        row[ai] = result;
        if (result < minimum) minimum = result;
      }
      if (minimum > maxCost) return maxCost + 1;
    }
    return result;
  }

  function suggest(wrong, candidates) {
    if (candidates.length > 750 || wrong.length > 40) return null;
    let best = wrong.length;
    let suggestion = null;
    for (const name of candidates) {
      if (name === wrong) continue;
      let maxDistance = Math.floor((name.length + wrong.length + 3) * 2 / 6);
      maxDistance = Math.min(maxDistance, best - 1);
      const d = levenshtein(wrong, name, maxDistance);
      if (d > maxDistance) continue;
      if (!suggestion || d < best) {
        suggestion = name;
        best = d;
      }
    }
    return suggestion;
  }

  // ---------- tokenizer ----------

  const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
  const UNSUPPORTED_KEYWORDS = new Set(['def', 'class', 'import', 'from', 'return', 'try', 'except', 'finally', 'with', 'as', 'lambda', 'global', 'nonlocal', 'del', 'assert', 'raise', 'yield', 'async', 'await']);
  const SOFT_KEYWORDS = new Set(['match', 'case', 'type', '_']);
  const ID_START = /[\p{L}\p{Nl}_]/u;
  const ID_CONT = /[\p{L}\p{Nl}\p{Mn}\p{Mc}\p{Nd}\p{Pc}]/u;
  const OPS3 = ['**=', '//=', '...', '>>=', '<<='];
  const OPS2 = ['**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '->', ':=', '<<', '>>', '&=', '|=', '^=', '@='];
  const OPS1 = '+-*/%<>=()[]{},:.;@&|^~!';
  const STRING_PREFIXES = new Set(['r', 'u', 'f', 'b', 'br', 'rb', 'fr', 'rf']);

  function unescape(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c !== '\\' || i + 1 >= raw.length) { out += c; continue; }
      const d = raw[++i];
      switch (d) {
        case '\n': break;
        case '\\': out += '\\'; break;
        case "'": out += "'"; break;
        case '"': out += '"'; break;
        case 'n': out += '\n'; break;
        case 't': out += '\t'; break;
        case 'r': out += '\r'; break;
        case 'a': out += '\x07'; break;
        case 'b': out += '\b'; break;
        case 'f': out += '\f'; break;
        case 'v': out += '\v'; break;
        case 'x': {
          const hex = raw.slice(i + 1, i + 3);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw syntaxError('(unicode error) \'unicodeescape\' codec can\'t decode bytes: truncated \\xXX escape');
          out += String.fromCharCode(parseInt(hex, 16));
          i += 2;
          break;
        }
        case 'u':
        case 'U': {
          const len = d === 'u' ? 4 : 8;
          const hex = raw.slice(i + 1, i + 1 + len);
          if (hex.length !== len || !/^[0-9a-fA-F]+$/.test(hex)) throw syntaxError(`(unicode error) 'unicodeescape' codec can't decode bytes: truncated \\${d}${'X'.repeat(len)} escape`);
          out += String.fromCodePoint(parseInt(hex, 16));
          i += len;
          break;
        }
        default:
          if (/[0-7]/.test(d)) {
            let oct = d;
            while (oct.length < 3 && /[0-7]/.test(raw[i + 1] || '')) oct += raw[++i];
            out += String.fromCharCode(parseInt(oct, 8));
          } else {
            out += '\\' + d;
          }
      }
    }
    return out;
  }

  function tokenize(src) {
    const toks = [];
    const indents = [0];
    const brackets = [];
    const n = src.length;
    let i = 0;
    let line = 1;
    let atLineStart = true;
    const add = (t, v, l) => toks.push({ t, v, line: l === undefined ? line : l });

    function readString(prefix) {
      const q = src[i];
      const triple = src.slice(i, i + 3) === q + q + q;
      const isRaw = prefix.includes('r');
      const isF = prefix.includes('f');
      const kind = isF ? 'f-string' : 'string';
      const startLine = line;
      let j = i + (triple ? 3 : 1);
      let raw = '';
      let depth = 0;
      for (;;) {
        if (j >= n) {
          throw syntaxError(`unterminated ${triple ? 'triple-quoted ' : ''}${kind} literal (detected at line ${line})`, startLine);
        }
        const ch = src[j];
        if (ch === '\\') {
          if (j + 1 >= n) { raw += ch; j++; continue; }
          raw += ch + src[j + 1];
          if (src[j + 1] === '\n') line++;
          j += 2;
          continue;
        }
        if (ch === '\n') {
          if (!triple) throw syntaxError(`unterminated ${kind} literal (detected at line ${line})`, line);
          raw += ch;
          line++;
          j++;
          continue;
        }
        if (isF) {
          if (ch === '{') {
            if (depth === 0 && src[j + 1] === '{') { raw += '{{'; j += 2; continue; }
            depth++;
          } else if (ch === '}') {
            if (depth === 0 && src[j + 1] === '}') { raw += '}}'; j += 2; continue; }
            if (depth > 0) depth--;
          } else if (depth > 0 && (ch === '"' || ch === "'")) {
            // A quoted string inside a replacement field (allowed since Python 3.12).
            // If no other quote of the f-string's own kind follows on this line, this
            // quote ends the f-string while a { is still open.
            if (ch === q && !triple) {
              const eol = src.indexOf('\n', j);
              const rest = src.slice(j + 1, eol < 0 ? n : eol);
              if (!rest.includes(q)) throw syntaxError("f-string: expecting '}'", startLine);
            }
            let k = j + 1;
            while (k < n && src[k] !== ch && src[k] !== '\n') k++;
            if (k >= n || src[k] === '\n') throw syntaxError(`unterminated ${kind} literal (detected at line ${line})`, line);
            raw += src.slice(j, k + 1);
            j = k + 1;
            continue;
          }
        }
        if (ch === q) {
          if (!triple) { j++; break; }
          if (src.slice(j, j + 3) === q + q + q) { j += 3; break; }
        }
        raw += ch;
        j++;
      }
      if (isF) add('FSTR', { raw, isRaw }, startLine);
      else add('STR', isRaw ? raw : unescape(raw), startLine);
      return j;
    }

    while (i < n) {
      if (atLineStart && brackets.length === 0) {
        let col = 0;
        let j = i;
        while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) {
          col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : src[j] === '\f' ? 0 : col + 1;
          j++;
        }
        if (j >= n || src[j] === '\n' || src[j] === '#') {
          while (j < n && src[j] !== '\n') j++;
          if (j < n) { j++; line++; }
          i = j;
          continue;
        }
        i = j;
        const top = indents[indents.length - 1];
        if (col > top) {
          indents.push(col);
          add('INDENT', col);
        } else if (col < top) {
          while (col < indents[indents.length - 1]) {
            indents.pop();
            add('DEDENT', col);
          }
          if (col !== indents[indents.length - 1]) throw indentError('unindent does not match any outer indentation level', line);
        }
        atLineStart = false;
      }

      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\f') { i++; continue; }
      if (c === '#') {
        while (i < n && src[i] !== '\n') i++;
        continue;
      }
      if (c === '\\') {
        if (src[i + 1] === '\n') { i += 2; line++; continue; }
        throw syntaxError('unexpected character after line continuation character', line);
      }
      if (c === '\n') {
        if (brackets.length === 0) {
          add('NL', null);
          atLineStart = true;
        }
        i++;
        line++;
        continue;
      }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        const start = i;
        if (c === '0' && /[xXoObB]/.test(src[i + 1] || '')) {
          i += 2;
          while (i < n && /[0-9a-zA-Z_]/.test(src[i])) i++;
          const text = src.slice(start, i).replace(/_/g, '').toLowerCase();
          let v;
          try { v = BigInt(text); } catch (e) { throw syntaxError(`invalid ${{ x: 'hexadecimal', o: 'octal', b: 'binary' }[text[1]]} literal`, line); }
          add('NUM', v);
          continue;
        }
        let isFloat = false;
        while (i < n && /[0-9_]/.test(src[i])) i++;
        if (src[i] === '.') {
          isFloat = true;
          i++;
          while (i < n && /[0-9_]/.test(src[i])) i++;
        }
        if (/[eE]/.test(src[i] || '') && /[0-9+-]/.test(src[i + 1] || '')) {
          isFloat = true;
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          if (!/[0-9]/.test(src[i] || '')) throw syntaxError('invalid decimal literal', line);
          while (i < n && /[0-9_]/.test(src[i])) i++;
        }
        if (/[jJ]/.test(src[i] || '')) throw new Unsupported('complex numbers', line);
        if (i < n && ID_CONT.test(src[i])) throw syntaxError('invalid decimal literal', line);
        const text = src.slice(start, i).replace(/_/g, '');
        if (isFloat) {
          add('NUM', parseFloat(text));
        } else {
          if (/^0+[1-9]/.test(text)) throw syntaxError('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers', line);
          add('NUM', BigInt(text));
        }
        continue;
      }

      if (ID_START.test(c)) {
        const start = i;
        i++;
        while (i < n && ID_CONT.test(src[i])) i++;
        const word = src.slice(start, i);
        if ((src[i] === '"' || src[i] === "'") && STRING_PREFIXES.has(word.toLowerCase())) {
          const prefix = word.toLowerCase();
          if (prefix.includes('b')) throw new Unsupported('bytes', line);
          i = readString(prefix);
          continue;
        }
        add('NAME', word);
        continue;
      }

      if (c === '"' || c === "'") {
        i = readString('');
        continue;
      }

      const three = src.slice(i, i + 3);
      const two = src.slice(i, i + 2);
      let op = null;
      if (OPS3.includes(three)) op = three;
      else if (OPS2.includes(two)) op = two;
      else if (OPS1.includes(c)) op = c;
      if (op) {
        if ('([{'.includes(op)) {
          brackets.push({ ch: op, line });
        } else if (')]}'.includes(op)) {
          const open = brackets.pop();
          if (!open) throw syntaxError(`unmatched '${op}'`, line);
          const want = { '(': ')', '[': ']', '{': '}' }[open.ch];
          if (want !== op) {
            if (open.line !== line) throw syntaxError(`closing parenthesis '${op}' does not match opening parenthesis '${open.ch}' on line ${open.line}`, line);
            throw syntaxError(`closing parenthesis '${op}' does not match opening parenthesis '${open.ch}'`, line);
          }
        }
        add('OP', op);
        i += op.length;
        continue;
      }

      const cp = src.codePointAt(i);
      const chr = String.fromCodePoint(cp);
      if (cp < 128) {
        add('OP', chr);
        i++;
        continue;
      }
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      if (/\s/u.test(chr) || cp === 0xFEFF || (cp >= 0x200B && cp <= 0x200D)) throw syntaxError(`invalid non-printable character U+${hex}`, line);
      throw syntaxError(`invalid character '${chr}' (U+${hex})`, line);
    }

    if (brackets.length) {
      const open = brackets[brackets.length - 1];
      throw syntaxError(`'${open.ch}' was never closed`, open.line);
    }
    const last = toks.length ? toks[toks.length - 1].t : 'NL';
    if (last !== 'NL' && last !== 'INDENT' && last !== 'DEDENT') add('NL', null);
    while (indents.length > 1) {
      indents.pop();
      add('DEDENT', 0);
    }
    add('EOF', null);
    return toks;
  }

  // ---------- parser ----------

  const COMPARE_OPS = new Set(['<', '>', '==', '>=', '<=', '!=']);
  const AUG_OPS = { '+=': '+', '-=': '-', '*=': '*', '/=': '/', '//=': '//', '%=': '%', '**=': '**' };

  function targetKind(e) {
    switch (e.k) {
      case 'Num': case 'Str': return 'literal';
      case 'FStr': return 'f-string expression';
      case 'Call': return 'function call';
      case 'Compare': return 'comparison';
      case 'IfExp': return 'conditional expression';
      case 'BinOp': case 'Unary': case 'BoolOp': case 'Not': return 'expression';
      default: return null;
    }
  }

  class Parser {
    constructor(toks, line) {
      this.toks = toks;
      this.p = 0;
      this.loopDepth = 0;
      this.lineOffset = line ? line - 1 : 0;
    }

    peek(o = 0) { return this.toks[Math.min(this.p + o, this.toks.length - 1)]; }
    next() { return this.toks[this.p++]; }
    isOp(v, o = 0) { const t = this.peek(o); return t.t === 'OP' && t.v === v; }
    isKw(v, o = 0) { const t = this.peek(o); return t.t === 'NAME' && t.v === v; }

    fail(tok) {
      tok = tok || this.peek();
      if (tok.t === 'INDENT') return indentError('unexpected indent', tok.line);
      return syntaxError('invalid syntax', tok.line);
    }

    // Tokens that can begin an expression (used for CPython's "forgot a comma" hint).
    startsExpr(tok) {
      if (tok.t === 'NUM' || tok.t === 'STR' || tok.t === 'FSTR') return true;
      if (tok.t === 'NAME') return !KEYWORDS.has(tok.v) || tok.v === 'True' || tok.v === 'False' || tok.v === 'None';
      return false;
    }

    parseFile() {
      const body = [];
      while (this.peek().t !== 'EOF') {
        if (this.peek().t === 'NL') { this.next(); continue; }
        body.push(...this.statement());
      }
      return body;
    }

    statement() {
      const t = this.peek();
      if (t.t === 'INDENT') throw indentError('unexpected indent', t.line);
      if (t.t === 'NAME') {
        if (t.v === 'if') return [this.ifStatement()];
        if (t.v === 'for') return [this.forStatement()];
        if (t.v === 'while') return [this.whileStatement()];
        if (t.v === 'elif' || t.v === 'else') throw syntaxError('invalid syntax', t.line);
      }
      return this.simpleLine();
    }

    simpleLine() {
      const stmts = [this.smallStatement()];
      while (this.isOp(';')) {
        this.next();
        if (this.peek().t === 'NL' || this.peek().t === 'EOF') break;
        stmts.push(this.smallStatement());
      }
      const t = this.peek();
      if (t.t === 'NL') this.next();
      else if (t.t !== 'EOF') throw this.fail(t);
      return stmts;
    }

    smallStatement() {
      const t = this.peek();
      if (t.t === 'NAME') {
        if (t.v === 'pass') { this.next(); return { k: 'Pass', line: t.line }; }
        if (t.v === 'break' || t.v === 'continue') {
          this.next();
          if (!this.loopDepth) throw syntaxError(t.v === 'break' ? "'break' outside loop" : "'continue' not properly in loop", t.line);
          return { k: t.v === 'break' ? 'Break' : 'Continue', line: t.line };
        }
        if (UNSUPPORTED_KEYWORDS.has(t.v)) throw new Unsupported(t.v, t.line);
      }
      const e = this.expr();
      if (e.k === 'Name' && (e.id === 'print' || e.id === 'exec') && this.startsExpr(this.peek())) {
        throw syntaxError(`Missing parentheses in call to '${e.id}'. Did you mean ${e.id}(...)?`, t.line);
      }
      if (this.isOp('=')) {
        const targets = [e];
        let value;
        while (this.isOp('=')) {
          this.next();
          const v = this.expr();
          if (this.isOp('=')) targets.push(v);
          else value = v;
        }
        for (const target of targets) this.checkTarget(target, false);
        return { k: 'Assign', targets, value, line: t.line };
      }
      const nt = this.peek();
      if (nt.t === 'OP' && AUG_OPS[nt.v]) {
        this.checkTarget(e, true);
        this.next();
        const value = this.expr();
        return { k: 'AugAssign', target: e, op: AUG_OPS[nt.v], value, line: t.line };
      }
      if (nt.t === 'OP' && /^(<<|>>|&|\||\^|@)=$/.test(nt.v)) throw new Unsupported('bitwise operators', t.line);
      return { k: 'Expr', e, line: t.line };
    }

    checkTarget(e, augmented) {
      if (e.k === 'Name' || e.k === 'Sub') return;
      if (e.k === 'Const') {
        const name = e.v === null ? 'None' : e.v ? 'True' : 'False';
        if (augmented) throw syntaxError(`'${name}' is an illegal expression for augmented assignment`, e.line);
        throw syntaxError(`cannot assign to ${name}`, e.line);
      }
      if (e.k === 'Attr') throw new Unsupported('changing attributes', e.line);
      if (e.k === 'List') throw new Unsupported('unpacking', e.line);
      const kind = targetKind(e) || 'expression';
      if (augmented) throw syntaxError(`'${kind}' is an illegal expression for augmented assignment`, e.line);
      throw syntaxError(`cannot assign to ${kind} here. Maybe you meant '==' instead of '='?`, e.line);
    }

    header(t) {
      if (this.isOp('=')) throw syntaxError("invalid syntax. Maybe you meant '==' or ':=' instead of '='?", this.peek().line);
      if (!this.isOp(':')) {
        if (this.peek().t === 'NL' || this.peek().t === 'EOF') throw syntaxError("expected ':'", t.line);
        throw this.fail();
      }
      this.next();
    }

    block(kind, headerLine) {
      if (this.peek().t === 'NL') {
        this.next();
        const t = this.peek();
        if (t.t !== 'INDENT') throw indentError(`expected an indented block after '${kind}' statement on line ${headerLine}`, t.t === 'EOF' ? headerLine + 1 : t.line);
        this.next();
        const body = [];
        while (this.peek().t !== 'DEDENT' && this.peek().t !== 'EOF') {
          if (this.peek().t === 'NL') { this.next(); continue; }
          body.push(...this.statement());
        }
        if (this.peek().t === 'DEDENT') this.next();
        return body;
      }
      return this.simpleLine();
    }

    ifStatement() {
      const t = this.next();
      const test = this.expr();
      this.header(t);
      const body = this.block(t.v, t.line);
      const node = { k: 'If', test, body, orelse: null, line: t.line, elif: t.v === 'elif' };
      if (this.isKw('elif')) {
        node.orelse = [this.ifStatement()];
      } else if (this.isKw('else')) {
        const et = this.next();
        this.header(et);
        node.elseLine = et.line;
        node.orelse = this.block('else', et.line);
      }
      return node;
    }

    forStatement() {
      const t = this.next();
      const tt = this.peek();
      if (tt.t !== 'NAME' || KEYWORDS.has(tt.v)) throw this.fail(tt);
      this.next();
      const target = { k: 'Name', id: tt.v, line: tt.line };
      if (this.isOp(',')) throw new Unsupported('unpacking', t.line);
      if (!this.isKw('in')) throw this.fail();
      this.next();
      const iter = this.expr();
      this.header(t);
      this.loopDepth++;
      const body = this.block('for', t.line);
      this.loopDepth--;
      return { k: 'For', target, iter, body, orelse: this.loopElse(), line: t.line };
    }

    whileStatement() {
      const t = this.next();
      const test = this.expr();
      this.header(t);
      this.loopDepth++;
      const body = this.block('while', t.line);
      this.loopDepth--;
      return { k: 'While', test, body, orelse: this.loopElse(), line: t.line };
    }

    loopElse() {
      if (!this.isKw('else')) return null;
      const et = this.next();
      this.header(et);
      return this.block('else', et.line);
    }

    // ----- expressions -----

    expr() {
      const start = this.peek();
      const e = this.orTest();
      if (this.isKw('if')) {
        this.next();
        const test = this.orTest();
        if (!this.isKw('else')) throw syntaxError("expected 'else' after 'if' expression", start.line);
        this.next();
        const orelse = this.expr();
        return { k: 'IfExp', test, body: e, orelse, line: start.line };
      }
      return e;
    }

    orTest() {
      const first = this.andTest();
      if (!this.isKw('or')) return first;
      const values = [first];
      while (this.isKw('or')) { this.next(); values.push(this.andTest()); }
      return { k: 'BoolOp', op: 'or', values, line: first.line };
    }

    andTest() {
      const first = this.notTest();
      if (!this.isKw('and')) return first;
      const values = [first];
      while (this.isKw('and')) { this.next(); values.push(this.notTest()); }
      return { k: 'BoolOp', op: 'and', values, line: first.line };
    }

    notTest() {
      if (this.isKw('not')) {
        const t = this.next();
        return { k: 'Not', e: this.notTest(), line: t.line };
      }
      return this.comparison();
    }

    comparison() {
      const left = this.arith();
      const ops = [];
      const comps = [];
      for (;;) {
        const t = this.peek();
        let op = null;
        if (t.t === 'OP' && COMPARE_OPS.has(t.v)) { op = t.v; this.next(); }
        else if (this.isKw('in')) { op = 'in'; this.next(); }
        else if (this.isKw('not') && this.isKw('in', 1)) { op = 'not in'; this.next(); this.next(); }
        else if (this.isKw('is')) {
          this.next();
          if (this.isKw('not')) { this.next(); op = 'is not'; } else op = 'is';
        }
        if (!op) break;
        ops.push(op);
        comps.push(this.arith());
      }
      const t = this.peek();
      if (t.t === 'OP' && ['|', '&', '^', '<<', '>>', '~'].includes(t.v)) throw new Unsupported('bitwise operators', t.line);
      if (!ops.length) return left;
      return { k: 'Compare', left, ops, comps, line: left.line };
    }

    arith() {
      let left = this.term();
      while (this.isOp('+') || this.isOp('-')) {
        const op = this.next().v;
        left = { k: 'BinOp', op, l: left, r: this.term(), line: left.line };
      }
      return left;
    }

    term() {
      let left = this.factor();
      for (;;) {
        const t = this.peek();
        if (t.t !== 'OP' || !['*', '/', '//', '%', '@'].includes(t.v)) break;
        if (t.v === '@') throw new Unsupported('matrix multiplication', t.line);
        this.next();
        left = { k: 'BinOp', op: t.v, l: left, r: this.factor(), line: left.line };
      }
      return left;
    }

    factor() {
      const t = this.peek();
      if (t.t === 'OP' && (t.v === '-' || t.v === '+')) {
        this.next();
        return { k: 'Unary', op: t.v, e: this.factor(), line: t.line };
      }
      if (t.t === 'OP' && t.v === '~') throw new Unsupported('bitwise operators', t.line);
      return this.power();
    }

    power() {
      const base = this.primary();
      if (this.isOp('**')) {
        this.next();
        return { k: 'BinOp', op: '**', l: base, r: this.factor(), line: base.line };
      }
      return base;
    }

    primary() {
      let e = this.atom();
      for (;;) {
        if (this.isOp('(')) {
          this.next();
          e = this.callArgs(e);
        } else if (this.isOp('[')) {
          this.next();
          const index = this.expr();
          if (this.isOp(':')) throw new Unsupported('slices', e.line);
          if (this.isOp(',')) throw new Unsupported('tuples', e.line);
          if (!this.isOp(']')) throw this.commaOrFail(index);
          this.next();
          e = { k: 'Sub', obj: e, index, line: e.line };
        } else if (this.isOp('.')) {
          this.next();
          const nt = this.peek();
          if (nt.t !== 'NAME') throw this.fail(nt);
          this.next();
          e = { k: 'Attr', obj: e, name: nt.v, line: e.line };
        } else {
          return e;
        }
      }
    }

    // Inside brackets, two expressions side by side get CPython's "forgot a comma" hint.
    commaOrFail(element) {
      const t = this.peek();
      if (this.startsExpr(t) && !element.namedThenString && !element.softKeyword) {
        return syntaxError('invalid syntax. Perhaps you forgot a comma?', element.line);
      }
      return this.fail(t);
    }

    element() {
      const start = this.peek();
      const namedThenString = start.t === 'NAME' && (this.peek(1).t === 'STR' || this.peek(1).t === 'FSTR');
      const softKeyword = start.t === 'NAME' && SOFT_KEYWORDS.has(start.v);
      const e = this.expr();
      if (namedThenString) e.namedThenString = true;
      if (softKeyword) e.softKeyword = true;
      return e;
    }

    callArgs(f) {
      const args = [];
      const kwargs = [];
      while (!this.isOp(')')) {
        const t = this.peek();
        if (t.t === 'OP' && (t.v === '*' || t.v === '**')) throw new Unsupported('star arguments', t.line);
        if (t.t === 'NAME' && !KEYWORDS.has(t.v) && this.isOp('=', 1)) {
          this.next();
          this.next();
          if (kwargs.some((k) => k.name === t.v)) throw syntaxError(`keyword argument repeated: ${t.v}`, t.line);
          kwargs.push({ name: t.v, value: this.expr() });
        } else {
          const a = this.element();
          if (this.isOp('=')) throw syntaxError('expression cannot contain assignment, perhaps you meant "=="?', a.line);
          if (this.isKw('for')) throw new Unsupported('comprehensions', a.line);
          if (kwargs.length) throw syntaxError('positional argument follows keyword argument', a.line);
          args.push(a);
          if (!this.isOp(',') && !this.isOp(')')) throw this.commaOrFail(a);
        }
        if (this.isOp(',')) { this.next(); continue; }
        if (!this.isOp(')')) throw this.fail();
      }
      this.next();
      return { k: 'Call', f, args, kwargs, line: f.line };
    }

    atom() {
      const t = this.peek();
      if (t.t === 'NAME') {
        if (t.v === 'True' || t.v === 'False' || t.v === 'None') {
          this.next();
          return { k: 'Const', v: t.v === 'None' ? null : t.v === 'True', line: t.line };
        }
        if (t.v === 'lambda' || t.v === 'await' || t.v === 'yield') throw new Unsupported(t.v, t.line);
        if (KEYWORDS.has(t.v)) throw this.fail(t);
        this.next();
        return { k: 'Name', id: t.v, line: t.line };
      }
      if (t.t === 'NUM') {
        this.next();
        return { k: 'Num', v: t.v, line: t.line };
      }
      if (t.t === 'STR' || t.t === 'FSTR') {
        const parts = [];
        let isF = false;
        while (this.peek().t === 'STR' || this.peek().t === 'FSTR') {
          const s = this.next();
          if (s.t === 'STR') parts.push(s.v);
          else {
            isF = true;
            parts.push(...parseFString(s.v.raw, s.v.isRaw, s.line));
          }
        }
        if (!isF) return { k: 'Str', v: parts.join(''), line: t.line };
        return { k: 'FStr', parts, line: t.line };
      }
      if (t.t === 'OP') {
        if (t.v === '(') {
          this.next();
          if (this.isOp(')')) throw new Unsupported('tuples', t.line);
          const e = this.element();
          if (this.isKw('for')) throw new Unsupported('comprehensions', t.line);
          if (this.isOp(',')) throw new Unsupported('tuples', t.line);
          if (!this.isOp(')')) throw this.commaOrFail(e);
          this.next();
          return Object.assign({}, e, { paren: true });
        }
        if (t.v === '[') {
          this.next();
          const items = [];
          while (!this.isOp(']')) {
            const e = this.element();
            if (this.isKw('for')) throw new Unsupported('comprehensions', t.line);
            items.push(e);
            if (this.isOp(',')) { this.next(); continue; }
            if (!this.isOp(']')) throw this.commaOrFail(e);
          }
          this.next();
          return { k: 'List', items, line: t.line };
        }
        if (t.v === '{') throw new Unsupported('dictionaries', t.line);
        if (t.v === '...') throw new Unsupported('Ellipsis', t.line);
      }
      throw this.fail(t);
    }
  }

  function parseFString(raw, isRaw, line) {
    const parts = [];
    let lit = '';
    const flush = () => {
      if (lit) parts.push(isRaw ? lit : unescape(lit));
      lit = '';
    };
    let i = 0;
    while (i < raw.length) {
      const c = raw[i];
      if (c === '{') {
        if (raw[i + 1] === '{') { lit += '{'; i += 2; continue; }
        let j = i + 1;
        let depth = 0;
        let quote = null;
        for (; j < raw.length; j++) {
          const ch = raw[j];
          if (quote) {
            if (ch === quote) quote = null;
            continue;
          }
          if (ch === '"' || ch === "'") quote = ch;
          else if ('([{'.includes(ch)) depth++;
          else if (')]}'.includes(ch)) {
            if (ch === '}' && depth === 0) break;
            depth--;
          } else if (depth === 0 && ((ch === '!' && raw[j + 1] !== '=') || ch === ':')) break;
        }
        if (j >= raw.length) throw syntaxError("f-string: expecting '}'", line);
        const exprText = raw.slice(i + 1, j);
        if (!exprText.trim()) throw syntaxError("f-string: valid expression required before '}'", line);
        if (/[^=!<>]=\s*$/.test(exprText)) throw new Unsupported('f-string = debugging', line);
        let conv = null;
        let spec = '';
        if (raw[j] === '!') {
          conv = raw[j + 1];
          if (!['r', 's', 'a'].includes(conv)) throw syntaxError('f-string: invalid conversion character: expected \'s\', \'r\', or \'a\'', line);
          j += 2;
        }
        if (raw[j] === ':') {
          const close = raw.indexOf('}', j);
          if (close < 0) throw syntaxError("f-string: expecting '}'", line);
          spec = raw.slice(j + 1, close);
          if (spec.includes('{')) throw new Unsupported('nested format specs', line);
          j = close;
        }
        if (raw[j] !== '}') throw syntaxError("f-string: expecting '}'", line);
        let e;
        try {
          const p = new Parser(tokenize(exprText.trim()));
          e = p.expr();
          if (p.peek().t !== 'NL' && p.peek().t !== 'EOF') throw p.fail();
        } catch (err) {
          if (err instanceof PyError || err instanceof Unsupported) err.line = line;
          throw err;
        }
        e.line = line;
        flush();
        parts.push({ e, conv, spec });
        i = j + 1;
        continue;
      }
      if (c === '}') {
        if (raw[i + 1] === '}') { lit += '}'; i += 2; continue; }
        throw syntaxError("f-string: single '}' is not allowed", line);
      }
      lit += c;
      i++;
    }
    flush();
    return parts;
  }

  function parse(code) {
    const src = String(code).replace(/\r\n?/g, '\n');
    return new Parser(tokenize(src)).parseFile();
  }

  // ---------- values ----------

  class PyList {
    constructor(items) { this.items = items; }
  }

  class PyRange {
    constructor(start, stop, step) {
      this.start = start;
      this.stop = stop;
      this.step = step;
    }
    get length() {
      const { start, stop, step } = this;
      if (step > 0n) return stop > start ? (stop - start + step - 1n) / step : 0n;
      return start > stop ? (start - stop - step - 1n) / -step : 0n;
    }
    *[Symbol.iterator]() {
      const { stop, step } = this;
      for (let v = this.start; step > 0n ? v < stop : v > stop; v += step) yield v;
    }
  }

  class PyFunc {
    constructor(name, fn, typeName) {
      this.name = name;
      this.fn = fn;
      this.typeName = typeName || 'builtin_function_or_method';
    }
  }

  class PyType {
    constructor(name, fn) {
      this.name = name;
      this.fn = fn || null;
    }
  }

  class PyMethod {
    constructor(self, name, fn) {
      this.self = self;
      this.name = name;
      this.fn = fn;
    }
  }

  const isInt = (v) => typeof v === 'bigint' || typeof v === 'boolean';
  const isNum = (v) => isInt(v) || typeof v === 'number';
  const isSeq = (v) => typeof v === 'string' || v instanceof PyList;
  const big = (v) => (typeof v === 'boolean' ? (v ? 1n : 0n) : v);

  function toFloat(v) {
    if (typeof v === 'number') return v;
    const f = Number(big(v));
    if (!isFinite(f)) throw new PyError('OverflowError', 'int too large to convert to float');
    return f;
  }

  function typeName(v) {
    if (v === null) return 'NoneType';
    if (typeof v === 'boolean') return 'bool';
    if (typeof v === 'bigint') return 'int';
    if (typeof v === 'number') return 'float';
    if (typeof v === 'string') return 'str';
    if (v instanceof PyList) return 'list';
    if (v instanceof PyRange) return 'range';
    if (v instanceof PyType) return 'type';
    if (v instanceof PyFunc) return v.typeName;
    if (v instanceof PyMethod) return 'builtin_function_or_method';
    return 'object';
  }

  function truthy(v) {
    if (v === null || v === false) return false;
    if (v === true) return true;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (v instanceof PyList) return v.items.length > 0;
    if (v instanceof PyRange) return v.length > 0n;
    return true;
  }

  function intToStr(v) {
    const s = v.toString();
    if (s.replace('-', '').length > 4300) throw valueError('Exceeds the limit (4300 digits) for integer string conversion; use sys.set_int_max_str_digits() to increase the limit');
    return s;
  }

  function floatRepr(x) {
    if (Number.isNaN(x)) return 'nan';
    if (!isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
    const ax = Math.abs(x);
    if (ax >= 1e16 || ax < 1e-4) {
      const [mant, exp] = x.toExponential().split('e');
      const sign = exp[0];
      let digits = exp.slice(1);
      if (digits.length < 2) digits = '0' + digits;
      return mant + 'e' + sign + digits;
    }
    const s = String(x);
    return s.includes('.') ? s : s + '.0';
  }

  function strRepr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let out = q;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      if (ch === '\\') out += '\\\\';
      else if (ch === q) out += '\\' + q;
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (cp < 32 || cp === 127) out += '\\x' + cp.toString(16).padStart(2, '0');
      else out += ch;
    }
    return out + q;
  }

  function pyRepr(v, seen) {
    if (v === null) return 'None';
    if (v === true) return 'True';
    if (v === false) return 'False';
    if (typeof v === 'bigint') return intToStr(v);
    if (typeof v === 'number') return floatRepr(v);
    if (typeof v === 'string') return strRepr(v);
    if (v instanceof PyList) {
      seen = seen || new Set();
      if (seen.has(v)) return '[...]';
      seen.add(v);
      const s = '[' + v.items.map((x) => pyRepr(x, seen)).join(', ') + ']';
      seen.delete(v);
      return s;
    }
    if (v instanceof PyRange) return `range(${v.start}, ${v.stop}${v.step !== 1n ? ', ' + v.step : ''})`;
    if (v instanceof PyType) return `<class '${v.name}'>`;
    if (v instanceof PyFunc) return `<built-in function ${v.name}>`;
    if (v instanceof PyMethod) return `<built-in method ${v.name} of ${typeName(v.self)} object>`;
    return '<object>';
  }

  const pyStr = (v) => (typeof v === 'string' ? v : pyRepr(v));

  // Python formats exact decimal ties (like 0.125 to 2 places) with round-half-even;
  // JavaScript's toFixed rounds them away from zero.
  function toFixedPy(x, digits) {
    if (Number.isNaN(x)) return 'nan';
    if (!isFinite(x)) return x > 0 ? 'inf' : '-inf';
    if (Math.abs(x) >= 1e21) {
      const s = BigInt(x).toString();
      return digits > 0 ? s + '.' + '0'.repeat(digits) : s;
    }
    let s = x.toFixed(digits);
    const exact = x.toFixed(Math.min(100, digits + 60));
    const [intPart, frac = ''] = exact.split('.');
    const rest = frac.slice(digits);
    if (/^50*$/.test(rest)) {
      const truncated = digits > 0 ? intPart + '.' + frac.slice(0, digits) : intPart;
      const lastDigit = Number(truncated[truncated.length - 1]);
      if (lastDigit % 2 === 0) s = truncated;
    }
    if (Object.is(x, -0) && !s.startsWith('-')) s = '-' + s;
    return s;
  }

  function groupDigits(intText, sep) {
    const neg = intText.startsWith('-');
    const digits = neg ? intText.slice(1) : intText;
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return (neg ? '-' : '') + grouped;
  }

  function formatSpec(v, spec) {
    if (spec === '') return pyStr(v);
    const m = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
    if (!m) throw valueError(`Invalid format specifier '${spec}' for object of type '${typeName(v)}'`);
    let [, fill, align, sign, alt, zero, width, grouping, precision, type] = m;
    if (alt) throw new Unsupported('the # format option');
    const isNumber = isNum(v);
    let body;
    let negative = false;
    if (typeof v === 'string') {
      if (type && type !== 's') throw valueError(`Unknown format code '${type}' for object of type 'str'`);
      if (sign) throw valueError('Sign not allowed in string format specifier');
      body = precision !== undefined ? [...v].slice(0, Number(precision)).join('') : v;
    } else if (isNumber) {
      let t = type;
      if (!t) t = isInt(v) && typeof v !== 'number' ? 'd' : precision !== undefined ? 'g' : 'r';
      if (t === 'd') {
        if (typeof v === 'number') throw valueError("Unknown format code 'd' for object of type 'float'");
        const n = big(v);
        negative = n < 0n;
        body = (negative ? -n : n).toString();
        if (grouping) body = groupDigits(body, grouping);
      } else if (t === 'f' || t === 'F' || t === '%') {
        let x = toFloat(v);
        if (t === '%') x *= 100;
        negative = x < 0 || Object.is(x, -0);
        body = toFixedPy(Math.abs(x), precision === undefined ? 6 : Number(precision));
        if (grouping) {
          const [ip, fp] = body.split('.');
          body = groupDigits(ip, grouping) + (fp !== undefined ? '.' + fp : '');
        }
        if (t === '%') body += '%';
      } else if (t === 'e' || t === 'E') {
        const x = toFloat(v);
        negative = x < 0;
        const [mant, exp] = Math.abs(x).toExponential(precision === undefined ? 6 : Number(precision)).split('e');
        let digits = exp.slice(1);
        if (digits.length < 2) digits = '0' + digits;
        body = mant + (t === 'E' ? 'E' : 'e') + exp[0] + digits;
      } else if (t === 'r') {
        const x = v;
        negative = x < 0 || Object.is(x, -0);
        body = floatRepr(Math.abs(x));
        if (grouping) {
          const [ip, fp] = body.split('.');
          body = groupDigits(ip, grouping) + (fp !== undefined ? '.' + fp : '');
        }
      } else if (t === 's') {
        throw valueError(`Unknown format code 's' for object of type '${typeName(v)}'`);
      } else {
        throw new Unsupported(`the '${t}' format code`);
      }
    } else {
      if (spec) throw typeError(`unsupported format string passed to ${typeName(v)}.__format__`);
      body = pyStr(v);
    }
    let signText = negative ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
    if (zero && !align) { fill = '0'; align = '='; }
    if (!align) align = isNumber ? '>' : '<';
    if (!fill) fill = ' ';
    const w = width ? Number(width) : 0;
    const len = [...(signText + body)].length;
    if (len >= w) return signText + body;
    const pad = w - len;
    if (align === '<') return signText + body + fill.repeat(pad);
    if (align === '>') return fill.repeat(pad) + signText + body;
    if (align === '=') return signText + fill.repeat(pad) + body;
    const left = Math.floor(pad / 2);
    return fill.repeat(left) + signText + body + fill.repeat(pad - left);
  }

  // ---------- operators ----------

  function bigFloorDiv(a, b) {
    let q = a / b;
    if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n;
    return q;
  }

  function bigMod(a, b) {
    let r = a % b;
    if (r !== 0n && ((r < 0n) !== (b < 0n))) r += b;
    return r;
  }

  function floatMod(a, b) {
    let mod = a % b;
    if (mod) {
      if ((b < 0) !== (mod < 0)) mod += b;
    } else {
      mod = b < 0 ? -0 : 0;
    }
    return mod;
  }

  // CPython's float_divmod floor division.
  function floatFloorDiv(a, b) {
    const mod = a % b;
    let div = (a - mod) / b;
    if (mod && ((b < 0) !== (mod < 0))) div -= 1;
    if (div) {
      let floordiv = Math.floor(div);
      if (div - floordiv > 0.5) floordiv += 1;
      return floordiv;
    }
    return a / b > 0 ? 0 : -0;
  }

  function bitLength(n) {
    return (n < 0n ? -n : n).toString(2).length;
  }

  function binop(op, a, b) {
    if (isNum(a) && isNum(b)) {
      const bothInt = isInt(a) && isInt(b);
      switch (op) {
        case '+': return bothInt ? big(a) + big(b) : toFloat(a) + toFloat(b);
        case '-': return bothInt ? big(a) - big(b) : toFloat(a) - toFloat(b);
        case '*': {
          if (bothInt) {
            const x = big(a);
            const y = big(b);
            if (bitLength(x) + bitLength(y) > 60000) throw new TooLong();
            return x * y;
          }
          return toFloat(a) * toFloat(b);
        }
        case '/': {
          const d = toFloat(b);
          if (d === 0) throw new PyError('ZeroDivisionError', 'division by zero');
          return toFloat(a) / d;
        }
        case '//': {
          if (bothInt) {
            if (big(b) === 0n) throw new PyError('ZeroDivisionError', 'integer division or modulo by zero');
            return bigFloorDiv(big(a), big(b));
          }
          if (toFloat(b) === 0) throw new PyError('ZeroDivisionError', 'float floor division by zero');
          return floatFloorDiv(toFloat(a), toFloat(b));
        }
        case '%': {
          if (bothInt) {
            if (big(b) === 0n) throw new PyError('ZeroDivisionError', 'integer modulo by zero');
            return bigMod(big(a), big(b));
          }
          if (toFloat(b) === 0) throw new PyError('ZeroDivisionError', 'float modulo by zero');
          return floatMod(toFloat(a), toFloat(b));
        }
        case '**': {
          if (bothInt && big(b) >= 0n) {
            const base = big(b) === 0n ? 1n : big(a);
            if (base !== 0n && base !== 1n && base !== -1n && BigInt(bitLength(base)) * big(b) > 60000n) throw new TooLong();
            return big(a) ** big(b);
          }
          const x = toFloat(a);
          const y = toFloat(b);
          if (x === 0 && y < 0) throw new PyError('ZeroDivisionError', '0.0 cannot be raised to a negative power');
          if (x < 0 && !Number.isInteger(y)) throw new Unsupported('complex numbers');
          const r = Math.pow(x, y);
          if (!isFinite(r) && isFinite(x) && isFinite(y)) throw new PyError('OverflowError', "(34, 'Numerical result out of range')");
          return r;
        }
      }
    }
    if (op === '+') {
      if (typeof a === 'string') {
        if (typeof b === 'string') return a + b;
        throw typeError(`can only concatenate str (not "${typeName(b)}") to str`);
      }
      if (a instanceof PyList) {
        if (b instanceof PyList) return new PyList([...a.items, ...b.items]);
        throw typeError(`can only concatenate list (not "${typeName(b)}") to list`);
      }
    }
    if (op === '*') {
      let seq = null;
      let count = null;
      if (isSeq(a) && isInt(b)) { seq = a; count = big(b); }
      else if (isInt(a) && isSeq(b)) { seq = b; count = big(a); }
      if (seq !== null) {
        const len = typeof seq === 'string' ? seq.length : seq.items.length;
        if (count > 0n && BigInt(len) * count > 1000000n) throw new TooLong();
        const k = count > 0n ? Number(count) : 0;
        if (typeof seq === 'string') return seq.repeat(k);
        const items = [];
        for (let i = 0; i < k; i++) items.push(...seq.items);
        return new PyList(items);
      }
      if (isSeq(a)) throw typeError(`can't multiply sequence by non-int of type '${typeName(b)}'`);
      if (isSeq(b)) throw typeError(`can't multiply sequence by non-int of type '${typeName(a)}'`);
    }
    if (op === '%' && typeof a === 'string') throw new Unsupported('% string formatting');
    const sym = op === '**' ? '** or pow()' : op;
    throw typeError(`unsupported operand type(s) for ${sym}: '${typeName(a)}' and '${typeName(b)}'`);
  }

  function unary(op, v) {
    if (isNum(v)) {
      if (op === '+') return typeof v === 'boolean' ? big(v) : v;
      return typeof v === 'number' ? -v : -big(v);
    }
    throw typeError(`bad operand type for unary ${op}: '${typeName(v)}'`);
  }

  function pyEq(a, b) {
    if (isNum(a) && isNum(b)) {
      if (isInt(a) && isInt(b)) return big(a) === big(b);
      return toFloat(a) === toFloat(b);
    }
    if (a instanceof PyList && b instanceof PyList) {
      if (a.items.length !== b.items.length) return false;
      return a.items.every((x, i) => pyEq(x, b.items[i]));
    }
    if (a instanceof PyRange && b instanceof PyRange) {
      const la = a.length;
      if (la !== b.length) return false;
      if (la === 0n) return true;
      if (a.start !== b.start) return false;
      return la === 1n || a.step === b.step;
    }
    return a === b;
  }

  function order(op, a, b) {
    let cmp = null;
    if (isNum(a) && isNum(b)) {
      if (isInt(a) && isInt(b)) {
        const x = big(a);
        const y = big(b);
        cmp = x < y ? -1 : x > y ? 1 : 0;
      } else {
        const x = toFloat(a);
        const y = toFloat(b);
        if (Number.isNaN(x) || Number.isNaN(y)) return false;
        cmp = x < y ? -1 : x > y ? 1 : 0;
      }
    } else if (typeof a === 'string' && typeof b === 'string') {
      cmp = a < b ? -1 : a > b ? 1 : 0;
    } else if (a instanceof PyList && b instanceof PyList) {
      const n = Math.min(a.items.length, b.items.length);
      for (let i = 0; i < n; i++) {
        if (!pyEq(a.items[i], b.items[i])) return order(op, a.items[i], b.items[i]);
      }
      cmp = a.items.length - b.items.length;
    } else {
      throw typeError(`'${op}' not supported between instances of '${typeName(a)}' and '${typeName(b)}'`);
    }
    switch (op) {
      case '<': return cmp < 0;
      case '>': return cmp > 0;
      case '<=': return cmp <= 0;
      default: return cmp >= 0;
    }
  }

  function contains(container, item) {
    if (typeof container === 'string') {
      if (typeof item !== 'string') throw typeError(`'in <string>' requires string as left operand, not ${typeName(item)}`);
      return container.includes(item);
    }
    if (container instanceof PyList) return container.items.some((x) => pyEq(x, item));
    if (container instanceof PyRange) {
      if (isInt(item)) {
        const v = big(item);
        const { start, stop, step } = container;
        const inBounds = step > 0n ? v >= start && v < stop : v <= start && v > stop;
        return inBounds && (v - start) % step === 0n;
      }
      for (const x of container) if (pyEq(x, item)) return true;
      return false;
    }
    throw typeError(`argument of type '${typeName(container)}' is not iterable`);
  }

  function compare(op, a, b) {
    switch (op) {
      case '==': return pyEq(a, b);
      case '!=': return !pyEq(a, b);
      case 'is': return a === b;
      case 'is not': return a !== b;
      case 'in': return contains(b, a);
      case 'not in': return !contains(b, a);
      default: return order(op, a, b);
    }
  }

  function iterate(v) {
    if (typeof v === 'string') return [...v];
    if (v instanceof PyList) {
      // Python iterates a list live, so changes during the loop are seen.
      return (function* () {
        for (let i = 0; i < v.items.length; i++) yield v.items[i];
      })();
    }
    if (v instanceof PyRange) return v[Symbol.iterator]();
    throw typeError(`'${typeName(v)}' object is not iterable`);
  }

  function toIndex(v) {
    if (isInt(v)) return big(v);
    throw typeError(`'${typeName(v)}' object cannot be interpreted as an integer`);
  }

  function roundHalfEven(x) {
    const f = Math.floor(x);
    const diff = x - f;
    if (diff > 0.5) return f + 1;
    if (diff < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
  }

  function pyRound(x, nd) {
    if (nd === undefined || nd === null) {
      if (isInt(x)) return big(x);
      if (Number.isNaN(x)) throw valueError('cannot convert float NaN to integer');
      if (!isFinite(x)) throw new PyError('OverflowError', 'cannot convert float infinity to integer');
      return BigInt(toFixedPy(x, 0));
    }
    const n = Number(toIndex(nd));
    if (isInt(x)) {
      const v = big(x);
      if (n >= 0) return v;
      const m = 10n ** BigInt(-n);
      const q = bigFloorDiv(v, m);
      const r = v - q * m;
      let qq = q;
      if (2n * r > m || (2n * r === m && q % 2n !== 0n)) qq = q + 1n;
      return qq * m;
    }
    if (!isFinite(x)) return x;
    if (n >= 0) {
      if (n > 300) return x;
      return parseFloat(toFixedPy(x, n));
    }
    const m = Math.pow(10, -n);
    return roundHalfEven(x / m) * m;
  }

  function parseIntText(s) {
    const t = s.trim();
    if (/^[+-]?\d+(_\d+)*$/.test(t)) return BigInt(t.replace(/_/g, ''));
    throw valueError(`invalid literal for int() with base 10: ${strRepr(s)}`);
  }

  function parseFloatText(s) {
    const t = s.trim().toLowerCase();
    if (/^[+-]?(inf|infinity)$/.test(t)) return t.startsWith('-') ? -Infinity : Infinity;
    if (/^[+-]?nan$/.test(t)) return NaN;
    if (/^[+-]?((\d+(_\d+)*)?\.?\d+(_\d+)*|\d+(_\d+)*\.)(e[+-]?\d+)?$/.test(t)) return parseFloat(t.replace(/_/g, ''));
    throw valueError(`could not convert string to float: ${strRepr(s)}`);
  }

  // ---------- builtins ----------

  function noKwargs(name, kw) {
    const keys = Object.keys(kw);
    if (keys.length) throw typeError(`${name}() takes no keyword arguments`);
  }

  function argCount(name, args, min, max) {
    if (args.length < min || args.length > max) {
      if (min === max && min === 1) throw typeError(`${name}() takes exactly one argument (${args.length} given)`);
      if (args.length < min) throw typeError(`${name} expected at least ${min} argument${min === 1 ? '' : 's'}, got ${args.length}`);
      throw typeError(`${name} expected at most ${max} argument${max === 1 ? '' : 's'}, got ${args.length}`);
    }
  }

  function items(v) {
    return [...iterate(v)];
  }

  function minMax(name, args, kw) {
    noKwargs(name, kw);
    if (!args.length) throw typeError(`${name} expected at least 1 argument, got 0`);
    const values = args.length === 1 ? items(args[0]) : args;
    if (!values.length) throw valueError(`${name}() iterable argument is empty`);
    let best = values[0];
    for (const v of values.slice(1)) {
      if (name === 'max' ? order('>', v, best) : order('<', v, best)) best = v;
    }
    return best;
  }

  const TYPES = {};

  function makeBuiltins(interp) {
    const b = new Map();
    for (const name of BUILTIN_NAMES) {
      b.set(name, new PyFunc(name, () => { throw new Unsupported(name + '()'); }));
    }
    b.set('print', new PyFunc('print', (args, kw) => {
      let sep = ' ';
      let end = '\n';
      for (const [key, val] of Object.entries(kw)) {
        if (key === 'sep' || key === 'end') {
          if (val !== null && typeof val !== 'string') throw typeError(`${key} must be None or a string, not ${typeName(val)}`);
          if (key === 'sep' && val !== null) sep = val;
          if (key === 'end' && val !== null) end = val;
        } else if (key !== 'flush') {
          throw typeError(`print() got an unexpected keyword argument '${key}'`);
        }
      }
      interp.write(args.map(pyStr).join(sep) + end);
      return null;
    }));
    b.set('len', new PyFunc('len', (args, kw) => {
      noKwargs('len', kw);
      argCount('len', args, 1, 1);
      const v = args[0];
      if (typeof v === 'string') return BigInt([...v].length);
      if (v instanceof PyList) return BigInt(v.items.length);
      if (v instanceof PyRange) return v.length;
      throw typeError(`object of type '${typeName(v)}' has no len()`);
    }));
    b.set('abs', new PyFunc('abs', (args, kw) => {
      noKwargs('abs', kw);
      argCount('abs', args, 1, 1);
      const v = args[0];
      if (typeof v === 'number') return Math.abs(v);
      if (isInt(v)) { const n = big(v); return n < 0n ? -n : n; }
      throw typeError(`bad operand type for abs(): '${typeName(v)}'`);
    }));
    b.set('round', new PyFunc('round', (args, kw) => {
      const x = args.length ? args[0] : kw.number;
      const nd = args.length > 1 ? args[1] : kw.ndigits;
      if (!isNum(x)) throw typeError(`type ${typeName(x)} doesn't define __round__ method`);
      return pyRound(x, nd);
    }));
    b.set('max', new PyFunc('max', (args, kw) => minMax('max', args, kw)));
    b.set('min', new PyFunc('min', (args, kw) => minMax('min', args, kw)));
    b.set('sum', new PyFunc('sum', (args, kw) => {
      noKwargs('sum', kw);
      if (!args.length) throw typeError('sum() takes at least 1 positional argument (0 given)');
      let total = args.length > 1 ? args[1] : 0n;
      for (const v of items(args[0])) {
        if (typeof v === 'string') throw typeError("unsupported operand type(s) for +: 'int' and 'str'");
        total = binop('+', total, v);
      }
      return total;
    }));
    b.set('sorted', new PyFunc('sorted', (args, kw) => {
      if (Object.keys(kw).some((k) => k !== 'reverse')) throw new Unsupported('sorted() with key');
      argCount('sorted', args, 1, 1);
      const list = items(args[0]);
      const sortedList = list.map((v, i) => [v, i]).sort((x, y) => (order('<', x[0], y[0]) ? -1 : order('<', y[0], x[0]) ? 1 : x[1] - y[1])).map((x) => x[0]);
      if (kw.reverse && truthy(kw.reverse)) sortedList.reverse();
      return new PyList(sortedList);
    }));
    b.set('repr', new PyFunc('repr', (args, kw) => {
      noKwargs('repr', kw);
      argCount('repr', args, 1, 1);
      return pyRepr(args[0]);
    }));
    b.set('input', new PyFunc('input', () => { throw new Unsupported('input()'); }));

    TYPES.int = new PyType('int', (args, kw) => {
      noKwargs('int', kw);
      if (args.length > 1) throw new Unsupported('int() with a base');
      if (!args.length) return 0n;
      const v = args[0];
      if (isInt(v)) return big(v);
      if (typeof v === 'number') {
        if (Number.isNaN(v)) throw valueError('cannot convert float NaN to integer');
        if (!isFinite(v)) throw new PyError('OverflowError', 'cannot convert float infinity to integer');
        return BigInt(Math.trunc(v));
      }
      if (typeof v === 'string') return parseIntText(v);
      throw typeError(`int() argument must be a string, a bytes-like object or a real number, not '${typeName(v)}'`);
    });
    TYPES.float = new PyType('float', (args, kw) => {
      noKwargs('float', kw);
      if (args.length > 1) throw typeError(`float expected at most 1 argument, got ${args.length}`);
      if (!args.length) return 0;
      const v = args[0];
      if (isNum(v)) return toFloat(v);
      if (typeof v === 'string') return parseFloatText(v);
      throw typeError(`float() argument must be a string or a real number, not '${typeName(v)}'`);
    });
    TYPES.str = new PyType('str', (args, kw) => {
      noKwargs('str', kw);
      if (args.length > 1) throw new Unsupported('str() with an encoding');
      return args.length ? pyStr(args[0]) : '';
    });
    TYPES.bool = new PyType('bool', (args, kw) => {
      noKwargs('bool', kw);
      if (args.length > 1) throw typeError(`bool expected at most 1 argument, got ${args.length}`);
      return args.length ? truthy(args[0]) : false;
    });
    TYPES.list = new PyType('list', (args, kw) => {
      noKwargs('list', kw);
      if (args.length > 1) throw typeError(`list expected at most 1 argument, got ${args.length}`);
      return new PyList(args.length ? items(args[0]) : []);
    });
    TYPES.range = new PyType('range', (args, kw) => {
      noKwargs('range', kw);
      argCount('range', args, 1, 3);
      const nums = args.map(toIndex);
      let start = 0n;
      let stop;
      let step = 1n;
      if (nums.length === 1) [stop] = nums;
      else [start, stop, step = 1n] = nums;
      if (step === 0n) throw valueError('range() arg 3 must not be zero');
      return new PyRange(start, stop, step);
    });
    TYPES.type = new PyType('type', (args, kw) => {
      noKwargs('type', kw);
      if (args.length !== 1) throw new Unsupported('type() with 3 arguments');
      const name = typeName(args[0]);
      return TYPES[name] || new PyType(name);
    });
    for (const name of ['int', 'float', 'str', 'bool', 'list', 'range', 'type']) b.set(name, TYPES[name]);
    return b;
  }

  // ---------- methods ----------

  function method(self, name, fn) {
    return new PyMethod(self, name, fn);
  }

  function needStr(v, what) {
    if (typeof v !== 'string') throw typeError(`${what} must be str, not ${typeName(v)}`);
    return v;
  }

  function stripChars(s, chars, left, right) {
    const set = chars === undefined || chars === null ? null : needStr(chars, 'strip arg');
    const isStrip = (ch) => (set === null ? /\s/.test(ch) : set.includes(ch));
    const arr = [...s];
    let a = 0;
    let z = arr.length;
    if (left) while (a < z && isStrip(arr[a])) a++;
    if (right) while (z > a && isStrip(arr[z - 1])) z--;
    return arr.slice(a, z).join('');
  }

  const STR_METHODS = {
    upper: (s) => s.toUpperCase(),
    lower: (s) => s.toLowerCase(),
    casefold: (s) => s.toLowerCase(),
    swapcase: (s) => [...s].map((c) => (c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())).join(''),
    title: (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (m, a, c) => a + c.toUpperCase()),
    capitalize: (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s),
    strip: (s, chars) => stripChars(s, chars, true, true),
    lstrip: (s, chars) => stripChars(s, chars, true, false),
    rstrip: (s, chars) => stripChars(s, chars, false, true),
    replace: (s, a, b) => s.split(needStr(a, 'replace() argument 1')).join(needStr(b, 'replace() argument 2')),
    count: (s, sub) => BigInt(needStr(sub, 'must be str') === '' ? [...s].length + 1 : s.split(sub).length - 1),
    startswith: (s, p) => s.startsWith(needStr(p, 'startswith first arg')),
    endswith: (s, p) => s.endsWith(needStr(p, 'endswith first arg')),
    find: (s, sub) => BigInt(s.indexOf(needStr(sub, 'must be str'))),
    split: (s, sep) => {
      if (sep === undefined || sep === null) return new PyList(s.split(/\s+/).filter((x) => x));
      if (needStr(sep, 'must be str or None') === '') throw valueError('empty separator');
      return new PyList(s.split(sep));
    },
    join: (s, it) => {
      const parts = items(it);
      parts.forEach((p, i) => {
        if (typeof p !== 'string') throw typeError(`sequence item ${i}: expected str instance, ${typeName(p)} found`);
      });
      return parts.join(s);
    },
    isdigit: (s) => s.length > 0 && /^\d+$/.test(s),
    isalpha: (s) => s.length > 0 && /^\p{L}+$/u.test(s),
    isupper: (s) => /\p{Lu}/u.test(s) && s === s.toUpperCase(),
    islower: (s) => /\p{Ll}/u.test(s) && s === s.toLowerCase(),
    zfill: (s, w) => {
      const width = Number(toIndex(w));
      if (s.length >= width) return s;
      const sign = s[0] === '-' || s[0] === '+' ? s[0] : '';
      return sign + '0'.repeat(width - s.length) + s.slice(sign.length);
    },
    center: (s, w) => formatSpec(s, '^' + Number(toIndex(w))),
    ljust: (s, w) => formatSpec(s, '<' + Number(toIndex(w))),
    rjust: (s, w) => formatSpec(s, '>' + Number(toIndex(w))),
  };

  function listIndex(list, i) {
    const n = BigInt(list.items.length);
    let k = toIndex(i);
    if (k < 0n) k += n;
    return k;
  }

  const LIST_METHODS = {
    append: (l, v) => { l.items.push(v); return null; },
    extend: (l, v) => { l.items.push(...items(v)); return null; },
    insert: (l, i, v) => {
      let k = listIndex(l, i);
      if (k < 0n) k = 0n;
      l.items.splice(Number(k > BigInt(l.items.length) ? BigInt(l.items.length) : k), 0, v);
      return null;
    },
    pop: (l, i) => {
      if (!l.items.length) throw new PyError('IndexError', 'pop from empty list');
      if (i === undefined) return l.items.pop();
      const k = listIndex(l, i);
      if (k < 0n || k >= BigInt(l.items.length)) throw new PyError('IndexError', 'pop index out of range');
      return l.items.splice(Number(k), 1)[0];
    },
    remove: (l, v) => {
      const k = l.items.findIndex((x) => pyEq(x, v));
      if (k < 0) throw valueError('list.remove(x): x not in list');
      l.items.splice(k, 1);
      return null;
    },
    index: (l, v) => {
      const k = l.items.findIndex((x) => pyEq(x, v));
      if (k < 0) throw valueError(`${pyRepr(v)} is not in list`);
      return BigInt(k);
    },
    count: (l, v) => BigInt(l.items.filter((x) => pyEq(x, v)).length),
    reverse: (l) => { l.items.reverse(); return null; },
    clear: (l) => { l.items.length = 0; return null; },
    copy: (l) => new PyList(l.items.slice()),
    sort: (l) => {
      l.items = l.items.map((v, i) => [v, i]).sort((x, y) => (order('<', x[0], y[0]) ? -1 : order('<', y[0], x[0]) ? 1 : x[1] - y[1])).map((x) => x[0]);
      return null;
    },
  };

  function getattr(obj, name) {
    let table = null;
    let known = [];
    if (typeof obj === 'string') { table = STR_METHODS; known = STR_ATTRS; }
    else if (obj instanceof PyList) { table = LIST_METHODS; known = LIST_ATTRS; }
    else if (typeof obj === 'bigint' || typeof obj === 'boolean') known = INT_ATTRS;
    else if (typeof obj === 'number') known = FLOAT_ATTRS;
    if (table && Object.prototype.hasOwnProperty.call(table, name)) {
      const fn = table[name];
      return method(obj, name, (args, kw) => {
        noKwargs(name, kw);
        return fn(obj, ...args);
      });
    }
    if (known.includes(name)) throw new Unsupported(`.${name}()`);
    const s = name.startsWith('_') ? null : suggest(name, known);
    throw new PyError('AttributeError', `'${typeName(obj)}' object has no attribute '${name}'` + (s ? `. Did you mean: '${s}'?` : ''));
  }

  function getitem(obj, index) {
    if (typeof obj === 'string' || obj instanceof PyList || obj instanceof PyRange) {
      if (!isInt(index)) {
        if (typeof obj === 'string') throw typeError(`string indices must be integers, not '${typeName(index)}'`);
        if (obj instanceof PyList) throw typeError(`list indices must be integers or slices, not ${typeName(index)}`);
        throw typeError(`range indices must be integers or slices, not ${typeName(index)}`);
      }
      const seq = typeof obj === 'string' ? [...obj] : obj instanceof PyList ? obj.items : null;
      const n = seq ? BigInt(seq.length) : obj.length;
      let k = big(index);
      if (k < 0n) k += n;
      if (k < 0n || k >= n) {
        const what = typeof obj === 'string' ? 'string' : obj instanceof PyList ? 'list' : 'range object';
        throw new PyError('IndexError', `${what} index out of range`);
      }
      if (seq) return seq[Number(k)];
      return obj.start + k * obj.step;
    }
    throw typeError(`'${typeName(obj)}' object is not subscriptable`);
  }

  // ---------- interpreter ----------

  class Interp {
    constructor(opts) {
      this.globals = new Map();
      this.builtins = makeBuiltins(this);
      this.out = [];
      this.outLen = 0;
      this.steps = 0;
      this.maxSteps = opts.maxSteps || 200000;
      this.maxOutput = opts.maxOutput || 200000;
      this.line = null;
    }

    write(s) {
      this.outLen += s.length;
      if (this.outLen > this.maxOutput) throw new TooLong(this.line);
      this.out.push(s);
    }

    tick() {
      if (++this.steps > this.maxSteps) throw new TooLong(this.line);
    }

    runBlock(stmts) {
      for (const s of stmts) this.exec(s);
    }

    exec(s) {
      this.tick();
      this.line = s.line;
      try {
        this.execInner(s);
      } catch (e) {
        if ((e instanceof PyError || e instanceof Unsupported || e instanceof TooLong) && !e.line) e.line = s.line;
        throw e;
      }
    }

    execInner(s) {
      switch (s.k) {
        case 'Expr':
          this.eval(s.e);
          return;
        case 'Assign': {
          const v = this.eval(s.value);
          for (const t of s.targets) this.assign(t, v);
          return;
        }
        case 'AugAssign': {
          const cur = this.eval(s.target);
          const v = this.eval(s.value);
          let result;
          if (s.op === '+' && cur instanceof PyList) {
            cur.items.push(...items(v));
            result = cur;
          } else {
            result = binop(s.op, cur, v);
          }
          this.assign(s.target, result);
          return;
        }
        case 'If':
          if (truthy(this.eval(s.test))) this.runBlock(s.body);
          else if (s.orelse) this.runBlock(s.orelse);
          return;
        case 'For': {
          const it = iterate(this.eval(s.iter));
          let broke = false;
          for (const v of it) {
            this.tick();
            this.assign(s.target, v);
            try {
              this.runBlock(s.body);
            } catch (e) {
              if (e === BREAK) { broke = true; break; }
              if (e === CONTINUE) continue;
              throw e;
            }
          }
          if (!broke && s.orelse) this.runBlock(s.orelse);
          return;
        }
        case 'While': {
          let broke = false;
          while (truthy(this.eval(s.test))) {
            this.tick();
            try {
              this.runBlock(s.body);
            } catch (e) {
              if (e === BREAK) { broke = true; break; }
              if (e === CONTINUE) continue;
              throw e;
            }
          }
          if (!broke && s.orelse) this.runBlock(s.orelse);
          return;
        }
        case 'Pass':
          return;
        case 'Break':
          throw BREAK;
        case 'Continue':
          throw CONTINUE;
      }
    }

    assign(target, v) {
      if (target.k === 'Name') {
        this.globals.set(target.id, v);
        return;
      }
      const obj = this.eval(target.obj);
      const index = this.eval(target.index);
      if (obj instanceof PyList) {
        if (!isInt(index)) throw typeError(`list indices must be integers or slices, not ${typeName(index)}`);
        let k = big(index);
        if (k < 0n) k += BigInt(obj.items.length);
        if (k < 0n || k >= BigInt(obj.items.length)) throw new PyError('IndexError', 'list assignment index out of range');
        obj.items[Number(k)] = v;
        return;
      }
      throw typeError(`'${typeName(obj)}' object does not support item assignment`);
    }

    lookup(id) {
      if (this.globals.has(id)) return this.globals.get(id);
      if (this.builtins.has(id)) return this.builtins.get(id);
      const userNames = [...this.globals.keys()];
      const candidates = [...MODULE_DUNDERS, ...userNames, ...MODULE_DUNDERS, ...userNames, ...BUILTIN_NAMES];
      const s = suggest(id, candidates);
      let msg = `name '${id}' is not defined`;
      if (s) msg += `. Did you mean: '${s}'?`;
      if (STDLIB_MODULES.has(id)) msg += s ? ` Or did you forget to import '${id}'?` : `. Did you forget to import '${id}'?`;
      const err = new PyError('NameError', msg);
      err.name = id;
      err.suggestion = s;
      throw err;
    }

    call(f, args, kw) {
      if (f instanceof PyFunc || f instanceof PyMethod) return f.fn(args, kw);
      if (f instanceof PyType) {
        if (!f.fn) throw new Unsupported(`${f.name}()`);
        return f.fn(args, kw);
      }
      throw typeError(`'${typeName(f)}' object is not callable`);
    }

    formatField(p) {
      let v = this.eval(p.e);
      if (p.conv === 'r') v = pyRepr(v);
      else if (p.conv === 's') v = pyStr(v);
      else if (p.conv === 'a') throw new Unsupported('!a conversion');
      return formatSpec(v, p.spec);
    }

    eval(e) {
      switch (e.k) {
        case 'Num':
        case 'Str':
        case 'Const':
          return e.v;
        case 'FStr':
          return e.parts.map((p) => (typeof p === 'string' ? p : this.formatField(p))).join('');
        case 'Name':
          return this.lookup(e.id);
        case 'List':
          return new PyList(e.items.map((x) => this.eval(x)));
        case 'BinOp':
          return binop(e.op, this.eval(e.l), this.eval(e.r));
        case 'Unary':
          return unary(e.op, this.eval(e.e));
        case 'Not':
          return !truthy(this.eval(e.e));
        case 'BoolOp': {
          let v = null;
          for (const x of e.values) {
            v = this.eval(x);
            if (e.op === 'and' ? !truthy(v) : truthy(v)) return v;
          }
          return v;
        }
        case 'Compare': {
          let left = this.eval(e.left);
          for (let i = 0; i < e.ops.length; i++) {
            const right = this.eval(e.comps[i]);
            if (!compare(e.ops[i], left, right)) return false;
            left = right;
          }
          return true;
        }
        case 'IfExp':
          return truthy(this.eval(e.test)) ? this.eval(e.body) : this.eval(e.orelse);
        case 'Call': {
          const f = this.eval(e.f);
          const args = e.args.map((a) => this.eval(a));
          const kw = {};
          for (const k of e.kwargs) kw[k.name] = this.eval(k.value);
          return this.call(f, args, kw);
        }
        case 'Attr':
          return getattr(this.eval(e.obj), e.name);
        case 'Sub':
          return getitem(this.eval(e.obj), this.eval(e.index));
      }
      throw new Error('Unknown node ' + e.k);
    }
  }

  function exportValue(v) {
    if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
    if (v instanceof PyList) return v.items.map(exportValue);
    if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') return v;
    return pyRepr(v);
  }

  function errorInfo(e) {
    if (e instanceof PyError) {
      return { kind: 'python', type: e.type, message: e.pyMessage, line: e.line, text: `${e.type}: ${e.pyMessage}`, name: e.name || null, suggestion: e.suggestion || null };
    }
    if (e instanceof Unsupported) return { kind: 'unsupported', what: e.what, line: e.line, text: `Not in this game yet: ${e.what}` };
    if (e instanceof TooLong) return { kind: 'toolong', line: e.line, text: 'Stopped: the program ran for too long' };
    if (e && e.name === 'RangeError') return { kind: 'toolong', line: null, text: 'Stopped: the program ran for too long' };
    return { kind: 'internal', line: null, text: String(e && e.message ? e.message : e) };
  }

  function splitLines(output) {
    if (!output) return [];
    const text = output.endsWith('\n') ? output.slice(0, -1) : output;
    return text.split('\n');
  }

  function run(code, opts) {
    opts = opts || {};
    const result = { output: '', lines: [], error: null, vars: {} };
    let interp = null;
    try {
      const ast = parse(code);
      interp = new Interp(opts);
      interp.runBlock(ast);
    } catch (e) {
      result.error = errorInfo(e);
      if (result.error.kind === 'internal' && typeof console !== 'undefined') console.error(e);
    }
    if (interp) {
      result.output = interp.out.join('');
      for (const [k, v] of interp.globals) result.vars[k] = exportValue(v);
    }
    result.lines = splitLines(result.output);
    return result;
  }

  // ---------- plain-language translation ("Pip's translation") ----------

  function litInt(e) {
    if (e.k === 'Num' && typeof e.v === 'bigint') return Number(e.v);
    if (e.k === 'Unary' && e.op === '-' && e.e.k === 'Num' && typeof e.e.v === 'bigint') return -Number(e.e.v);
    return null;
  }

  const COMPARE_WORDS = { '>': 'is more than', '<': 'is less than', '>=': 'is at least', '<=': 'is at most', '==': 'is equal to', '!=': 'is not equal to', in: 'is inside', 'not in': 'is not inside', is: 'is', 'is not': 'is not' };

  function describe(e) {
    switch (e.k) {
      case 'Num': return typeof e.v === 'bigint' ? e.v.toString() : floatRepr(e.v);
      case 'Str': return `"${e.v}"`;
      case 'FStr': return '"' + e.parts.map((p) => (typeof p === 'string' ? p : `[${describe(p.e)}]`)).join('') + '"';
      case 'Const': return e.v === null ? 'nothing' : e.v ? 'True' : 'False';
      case 'Name': return e.id;
      case 'List': return e.items.length ? `a list of ${e.items.length} thing${e.items.length === 1 ? '' : 's'}` : 'an empty list';
      case 'Unary': return e.op === '-' ? `minus ${describe(e.e)}` : describe(e.e);
      case 'Not': return `not (${describe(e.e)})`;
      case 'BoolOp': return e.values.map(describe).join(` ${e.op} `);
      case 'IfExp': return `${describe(e.body)} if ${describe(e.test)}, otherwise ${describe(e.orelse)}`;
      case 'Compare': {
        let s = describe(e.left);
        e.ops.forEach((op, i) => { s += ` ${COMPARE_WORDS[op]} ${describe(e.comps[i])}`; });
        return s;
      }
      case 'BinOp': {
        const l = describe(e.l);
        const r = describe(e.r);
        switch (e.op) {
          case '+': return (e.l.k === 'Str' || e.r.k === 'Str') ? `${l} joined to ${r}` : `${l} plus ${r}`;
          case '-': return `${l} minus ${r}`;
          case '*': return `${l} times ${r}`;
          case '/': return `${l} divided by ${r}`;
          case '//': return `how many each when ${l} is shared between ${r}`;
          case '%': return `what's left over when ${l} is shared between ${r}`;
          case '**': return `${l} to the power of ${r}`;
        }
        return `${l} ${e.op} ${r}`;
      }
      case 'Call': {
        const fname = e.f.k === 'Name' ? e.f.id : null;
        const a = e.args.map(describe);
        if (fname === 'len') return `the length of ${a[0] || 'nothing'}`;
        if (fname === 'str') return `${a[0] || 'nothing'} as words`;
        if (fname === 'int') return `${a[0] || '0'} as a whole number`;
        if (fname === 'float') return `${a[0] || '0'} as a decimal number`;
        if (fname === 'sorted' && e.args.length === 1) {
          const rev = e.kwargs && e.kwargs.some((k) => k.name === 'reverse');
          return rev ? `${a[0]} sorted from biggest to smallest` : `${a[0]} sorted from smallest to biggest`;
        }
        if (fname === 'max' && e.args.length === 1) return `the biggest in ${a[0]}`;
        if (fname === 'min' && e.args.length === 1) return `the smallest in ${a[0]}`;
        if (fname === 'max') return `the biggest of ${a.join(' and ')}`;
        if (fname === 'min') return `the smallest of ${a.join(' and ')}`;
        if (fname === 'sum' && e.args.length === 1) return `everything in ${a[0]} added up`;
        if (fname === 'round' && e.args.length === 1) return `${a[0]} rounded to a whole number`;
        if (fname === 'round' && e.args.length === 2) {
          const n = litInt(e.args[1]);
          return n === 1 ? `${a[0]} rounded to 1 decimal place` : `${a[0]} rounded to ${a[1]} decimal places`;
        }
        if (fname === 'range') {
          const nums = e.args.map(litInt);
          if (e.args.length === 1 && nums[0] !== null) return `the numbers 0 to ${nums[0] - 1}`;
          if (e.args.length === 2 && nums[0] !== null && nums[1] !== null) return `the numbers ${nums[0]} to ${nums[1] - 1}`;
          return `the numbers in range(${a.join(', ')})`;
        }
        if (e.f.k === 'Attr') {
          const obj = describe(e.f.obj);
          if (e.f.name === 'upper') return `${obj} in CAPITAL letters`;
          if (e.f.name === 'lower') return `${obj} in small letters`;
          if (e.f.name === 'title') return `${obj} with Capital First Letters`;
          return `${obj}.${e.f.name}(${a.join(', ')})`;
        }
        return `${fname || describe(e.f)}(${a.join(', ')})`;
      }
      case 'Attr': return `${describe(e.obj)}.${e.name}`;
      case 'Sub': return `item ${describe(e.index)} of ${describe(e.obj)}`;
    }
    return '…';
  }

  function describeShown(e, loopVars) {
    if (e.k === 'Name') return loopVars && loopVars.has(e.id) ? `the current ${e.id}` : `what's in the jar ${e.id}`;
    return describe(e);
  }

  function explainStatement(s, loopVars) {
    switch (s.k) {
      case 'Expr': {
        const e = s.e;
        if (e.k === 'Call' && e.f.k === 'Name' && e.f.id === 'print') {
          if (!e.args.length) return 'Show an empty line';
          if (e.args.every((a) => a.k === 'Str')) return 'Show: ' + e.args.map((a) => a.v).join(' ');
          return 'Show ' + e.args.map((a) => describeShown(a, loopVars)).join(', then ');
        }
        if (e.k === 'Call' && e.f.k === 'Attr' && e.f.name === 'append') return `Add ${describe(e.args[0] || { k: 'Const', v: null })} to the end of ${describe(e.f.obj)}`;
        if (e.k === 'Call' && e.f.k === 'Attr' && e.f.name === 'sort' && !e.args.length) {
          const rev = e.kwargs && e.kwargs.some((k) => k.name === 'reverse');
          return `Sort ${describe(e.f.obj)} from ${rev ? 'biggest to smallest' : 'smallest to biggest'}`;
        }
        if (e.k === 'Call' && e.f.k === 'Attr' && e.f.name === 'remove') return `Take ${describe(e.args[0] || { k: 'Const', v: null })} out of ${describe(e.f.obj)}`;
        return `Work out ${describe(e)}`;
      }
      case 'Assign': {
        const v = s.value;
        if (s.targets.length === 1 && s.targets[0].k === 'Name') {
          const name = s.targets[0].id;
          if (v.k === 'BinOp' && v.l.k === 'Name' && v.l.id === name) {
            if (v.op === '+') return `Add ${describe(v.r)} to the jar ${name}`;
            if (v.op === '-') return `Take ${describe(v.r)} out of the jar ${name}`;
          }
          return `Put ${describe(v)} in the jar labelled ${name}`;
        }
        if (s.targets.every((t) => t.k === 'Name')) return `Put ${describe(v)} in the jars ${s.targets.map((t) => t.id).join(' and ')}`;
        const t = s.targets[0];
        return `Change ${describe(t)} to ${describe(v)}`;
      }
      case 'AugAssign': {
        const name = describe(s.target);
        const v = describe(s.value);
        if (s.op === '+') return `Add ${v} to the jar ${name}`;
        if (s.op === '-') return `Take ${v} out of the jar ${name}`;
        if (s.op === '*') return `Multiply the jar ${name} by ${v}`;
        if (s.op === '/') return `Divide the jar ${name} by ${v}`;
        return `Change the jar ${name} using ${s.op} ${v}`;
      }
      case 'If': return `${s.elif ? 'Otherwise, if' : 'If'} ${describe(s.test)}:`;
      case 'While': return `Keep repeating while ${describe(s.test)}:`;
      case 'For': {
        const v = s.target.id;
        const it = s.iter;
        if (it.k === 'Call' && it.f.k === 'Name' && it.f.id === 'range') {
          const nums = it.args.map(litInt);
          if (it.args.length === 1) {
            if (nums[0] !== null) return nums[0] > 0 ? `Repeat ${nums[0]} times (${v} counts 0 to ${nums[0] - 1}):` : 'Repeat 0 times:';
            return `Repeat ${describe(it.args[0])} times (${v} counts from 0):`;
          }
          if (it.args.length === 2) {
            if (nums[0] !== null && nums[1] !== null) return `Count ${v} from ${nums[0]} to ${nums[1] - 1}, and each time:`;
            return `Count ${v} from ${describe(it.args[0])} up to (not including) ${describe(it.args[1])}:`;
          }
          return `Count ${v} from ${describe(it.args[0])} up to (not including) ${describe(it.args[1])}, jumping by ${describe(it.args[2])}:`;
        }
        if (it.k === 'Str') return `For each letter ${v} in "${it.v}":`;
        return `For each ${v} in ${describe(it)}:`;
      }
      case 'Pass': return 'Do nothing (yet)';
      case 'Break': return 'Stop the loop now';
      case 'Continue': return 'Skip to the next turn of the loop';
    }
    return '…';
  }

  // Returns one entry per source line: null for blank lines, otherwise
  // { text, depth } where text is null if Pip can't read that line.
  function explain(code) {
    const src = String(code).replace(/\r\n?/g, '\n');
    const lines = src.split('\n');
    const out = new Array(lines.length).fill(null);
    const put = (line, text, depth) => {
      const i = line - 1;
      if (i < 0 || i >= out.length) return;
      if (out[i] && out[i].text) out[i].text += '; then ' + text.charAt(0).toLowerCase() + text.slice(1);
      else out[i] = { text, depth };
    };
    const walk = (stmts, depth, loopVars) => {
      for (const s of stmts) {
        put(s.line, explainStatement(s, loopVars), depth);
        if (s.k === 'If') {
          walk(s.body, depth + 1, loopVars);
          if (s.orelse) {
            if (s.orelse.length === 1 && s.orelse[0].k === 'If' && s.orelse[0].elif) walk(s.orelse, depth, loopVars);
            else {
              if (s.elseLine) put(s.elseLine, 'Otherwise:', depth);
              walk(s.orelse, depth + 1, loopVars);
            }
          }
        } else if (s.k === 'For' || s.k === 'While') {
          const inner = s.k === 'For' ? new Set([...loopVars, s.target.id]) : loopVars;
          walk(s.body, depth + 1, inner);
          if (s.orelse) walk(s.orelse, depth + 1, loopVars);
        }
      }
    };
    try {
      walk(parse(src), 0, new Set());
      return out;
    } catch (e) {
      lines.forEach((ln, i) => {
        const t = ln.trim();
        if (!t || t.startsWith('#')) return;
        const depth = Math.floor((ln.length - ln.trimStart().length) / 4);
        try {
          const ast = parse(t.endsWith(':') ? t + '\n    pass\n' : t + '\n');
          out[i] = { text: explainStatement(ast[0]), depth };
        } catch (err) {
          out[i] = { text: null, depth };
        }
      });
      return out;
    }
  }

  const api = { run, explain, parse, version: '1.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PyMini = api;
})(typeof window !== 'undefined' ? window : globalThis);
