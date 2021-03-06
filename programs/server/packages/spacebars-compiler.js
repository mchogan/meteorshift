(function () {

/* Imports */
var Meteor = Package.meteor.Meteor;
var HTML = Package.htmljs.HTML;
var HTMLTools = Package['html-tools'].HTMLTools;
var BlazeTools = Package['blaze-tools'].BlazeTools;
var _ = Package.underscore._;
var CssTools = Package.minifiers.CssTools;
var UglifyJSMinify = Package.minifiers.UglifyJSMinify;

/* Package-scope variables */
var SpacebarsCompiler, TemplateTag;

(function () {

////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                        //
// packages/spacebars-compiler/templatetag.js                                             //
//                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////
                                                                                          //
SpacebarsCompiler = {};                                                                   // 1
                                                                                          // 2
// A TemplateTag is the result of parsing a single `{{...}}` tag.                         // 3
//                                                                                        // 4
// The `.type` of a TemplateTag is one of:                                                // 5
//                                                                                        // 6
// - `"DOUBLE"` - `{{foo}}`                                                               // 7
// - `"TRIPLE"` - `{{{foo}}}`                                                             // 8
// - `"COMMENT"` - `{{! foo}}`                                                            // 9
// - `"BLOCKCOMMENT" - `{{!-- foo--}}`                                                    // 10
// - `"INCLUSION"` - `{{> foo}}`                                                          // 11
// - `"BLOCKOPEN"` - `{{#foo}}`                                                           // 12
// - `"BLOCKCLOSE"` - `{{/foo}}`                                                          // 13
// - `"ELSE"` - `{{else}}`                                                                // 14
//                                                                                        // 15
// Besides `type`, the mandatory properties of a TemplateTag are:                         // 16
//                                                                                        // 17
// - `path` - An array of one or more strings.  The path of `{{foo.bar}}`                 // 18
//   is `["foo", "bar"]`.  Applies to DOUBLE, TRIPLE, INCLUSION, BLOCKOPEN,               // 19
//   and BLOCKCLOSE.                                                                      // 20
//                                                                                        // 21
// - `args` - An array of zero or more argument specs.  An argument spec                  // 22
//   is a two or three element array, consisting of a type, value, and                    // 23
//   optional keyword name.  For example, the `args` of `{{foo "bar" x=3}}`               // 24
//   are `[["STRING", "bar"], ["NUMBER", 3, "x"]]`.  Applies to DOUBLE,                   // 25
//   TRIPLE, INCLUSION, and BLOCKOPEN.                                                    // 26
//                                                                                        // 27
// - `value` - A string of the comment's text. Applies to COMMENT and                     // 28
//   BLOCKCOMMENT.                                                                        // 29
//                                                                                        // 30
// These additional are typically set during parsing:                                     // 31
//                                                                                        // 32
// - `position` - The HTMLTools.TEMPLATE_TAG_POSITION specifying at what sort             // 33
//   of site the TemplateTag was encountered (e.g. at element level or as                 // 34
//   part of an attribute value). Its absence implies                                     // 35
//   TEMPLATE_TAG_POSITION.ELEMENT.                                                       // 36
//                                                                                        // 37
// - `content` and `elseContent` - When a BLOCKOPEN tag's contents are                    // 38
//   parsed, they are put here.  `elseContent` will only be present if                    // 39
//   an `{{else}}` was found.                                                             // 40
                                                                                          // 41
var TEMPLATE_TAG_POSITION = HTMLTools.TEMPLATE_TAG_POSITION;                              // 42
                                                                                          // 43
TemplateTag = SpacebarsCompiler.TemplateTag = function () {                               // 44
  HTMLTools.TemplateTag.apply(this, arguments);                                           // 45
};                                                                                        // 46
TemplateTag.prototype = new HTMLTools.TemplateTag;                                        // 47
TemplateTag.prototype.constructorName = 'SpacebarsCompiler.TemplateTag';                  // 48
                                                                                          // 49
var makeStacheTagStartRegex = function (r) {                                              // 50
  return new RegExp(r.source + /(?![{>!#/])/.source,                                      // 51
                    r.ignoreCase ? 'i' : '');                                             // 52
};                                                                                        // 53
                                                                                          // 54
var starts = {                                                                            // 55
  ELSE: makeStacheTagStartRegex(/^\{\{\s*else(?=[\s}])/i),                                // 56
  DOUBLE: makeStacheTagStartRegex(/^\{\{\s*(?!\s)/),                                      // 57
  TRIPLE: makeStacheTagStartRegex(/^\{\{\{\s*(?!\s)/),                                    // 58
  BLOCKCOMMENT: makeStacheTagStartRegex(/^\{\{\s*!--/),                                   // 59
  COMMENT: makeStacheTagStartRegex(/^\{\{\s*!/),                                          // 60
  INCLUSION: makeStacheTagStartRegex(/^\{\{\s*>\s*(?!\s)/),                               // 61
  BLOCKOPEN: makeStacheTagStartRegex(/^\{\{\s*#\s*(?!\s)/),                               // 62
  BLOCKCLOSE: makeStacheTagStartRegex(/^\{\{\s*\/\s*(?!\s)/)                              // 63
};                                                                                        // 64
                                                                                          // 65
var ends = {                                                                              // 66
  DOUBLE: /^\s*\}\}/,                                                                     // 67
  TRIPLE: /^\s*\}\}\}/                                                                    // 68
};                                                                                        // 69
                                                                                          // 70
// Parse a tag from the provided scanner or string.  If the input                         // 71
// doesn't start with `{{`, returns null.  Otherwise, either succeeds                     // 72
// and returns a SpacebarsCompiler.TemplateTag, or throws an error (using                 // 73
// `scanner.fatal` if a scanner is provided).                                             // 74
TemplateTag.parse = function (scannerOrString) {                                          // 75
  var scanner = scannerOrString;                                                          // 76
  if (typeof scanner === 'string')                                                        // 77
    scanner = new HTMLTools.Scanner(scannerOrString);                                     // 78
                                                                                          // 79
  if (! (scanner.peek() === '{' &&                                                        // 80
         (scanner.rest()).slice(0, 2) === '{{'))                                          // 81
    return null;                                                                          // 82
                                                                                          // 83
  var run = function (regex) {                                                            // 84
    // regex is assumed to start with `^`                                                 // 85
    var result = regex.exec(scanner.rest());                                              // 86
    if (! result)                                                                         // 87
      return null;                                                                        // 88
    var ret = result[0];                                                                  // 89
    scanner.pos += ret.length;                                                            // 90
    return ret;                                                                           // 91
  };                                                                                      // 92
                                                                                          // 93
  var advance = function (amount) {                                                       // 94
    scanner.pos += amount;                                                                // 95
  };                                                                                      // 96
                                                                                          // 97
  var scanIdentifier = function (isFirstInPath) {                                         // 98
    var id = BlazeTools.parseIdentifierName(scanner);                                     // 99
    if (! id)                                                                             // 100
      expected('IDENTIFIER');                                                             // 101
    if (isFirstInPath &&                                                                  // 102
        (id === 'null' || id === 'true' || id === 'false'))                               // 103
      scanner.fatal("Can't use null, true, or false, as an identifier at start of path"); // 104
                                                                                          // 105
    return id;                                                                            // 106
  };                                                                                      // 107
                                                                                          // 108
  var scanPath = function () {                                                            // 109
    var segments = [];                                                                    // 110
                                                                                          // 111
    // handle initial `.`, `..`, `./`, `../`, `../..`, `../../`, etc                      // 112
    var dots;                                                                             // 113
    if ((dots = run(/^[\.\/]+/))) {                                                       // 114
      var ancestorStr = '.'; // eg `../../..` maps to `....`                              // 115
      var endsWithSlash = /\/$/.test(dots);                                               // 116
                                                                                          // 117
      if (endsWithSlash)                                                                  // 118
        dots = dots.slice(0, -1);                                                         // 119
                                                                                          // 120
      _.each(dots.split('/'), function(dotClause, index) {                                // 121
        if (index === 0) {                                                                // 122
          if (dotClause !== '.' && dotClause !== '..')                                    // 123
            expected("`.`, `..`, `./` or `../`");                                         // 124
        } else {                                                                          // 125
          if (dotClause !== '..')                                                         // 126
            expected("`..` or `../`");                                                    // 127
        }                                                                                 // 128
                                                                                          // 129
        if (dotClause === '..')                                                           // 130
          ancestorStr += '.';                                                             // 131
      });                                                                                 // 132
                                                                                          // 133
      segments.push(ancestorStr);                                                         // 134
                                                                                          // 135
      if (!endsWithSlash)                                                                 // 136
        return segments;                                                                  // 137
    }                                                                                     // 138
                                                                                          // 139
    while (true) {                                                                        // 140
      // scan a path segment                                                              // 141
                                                                                          // 142
      if (run(/^\[/)) {                                                                   // 143
        var seg = run(/^[\s\S]*?\]/);                                                     // 144
        if (! seg)                                                                        // 145
          error("Unterminated path segment");                                             // 146
        seg = seg.slice(0, -1);                                                           // 147
        if (! seg && ! segments.length)                                                   // 148
          error("Path can't start with empty string");                                    // 149
        segments.push(seg);                                                               // 150
      } else {                                                                            // 151
        var id = scanIdentifier(! segments.length);                                       // 152
        if (id === 'this') {                                                              // 153
          if (! segments.length) {                                                        // 154
            // initial `this`                                                             // 155
            segments.push('.');                                                           // 156
          } else {                                                                        // 157
            error("Can only use `this` at the beginning of a path.\nInstead of `foo.this` or `../this`, just write `foo` or `..`.");
          }                                                                               // 159
        } else {                                                                          // 160
          segments.push(id);                                                              // 161
        }                                                                                 // 162
      }                                                                                   // 163
                                                                                          // 164
      var sep = run(/^[\.\/]/);                                                           // 165
      if (! sep)                                                                          // 166
        break;                                                                            // 167
    }                                                                                     // 168
                                                                                          // 169
    return segments;                                                                      // 170
  };                                                                                      // 171
                                                                                          // 172
  // scan the keyword portion of a keyword argument                                       // 173
  // (the "foo" portion in "foo=bar").                                                    // 174
  // Result is either the keyword matched, or null                                        // 175
  // if we're not at a keyword argument position.                                         // 176
  var scanArgKeyword = function () {                                                      // 177
    var match = /^([^\{\}\(\)\>#=\s"'\[\]]+)\s*=\s*/.exec(scanner.rest());                // 178
    if (match) {                                                                          // 179
      scanner.pos += match[0].length;                                                     // 180
      return match[1];                                                                    // 181
    } else {                                                                              // 182
      return null;                                                                        // 183
    }                                                                                     // 184
  };                                                                                      // 185
                                                                                          // 186
  // scan an argument; succeeds or errors.                                                // 187
  // Result is an array of two or three items:                                            // 188
  // type , value, and (indicating a keyword argument)                                    // 189
  // keyword name.                                                                        // 190
  var scanArg = function () {                                                             // 191
    var keyword = scanArgKeyword(); // null if not parsing a kwarg                        // 192
    var value = scanArgValue();                                                           // 193
    return keyword ? value.concat(keyword) : value;                                       // 194
  };                                                                                      // 195
                                                                                          // 196
  // scan an argument value (for keyword or positional arguments);                        // 197
  // succeeds or errors.  Result is an array of type, value.                              // 198
  var scanArgValue = function () {                                                        // 199
    var startPos = scanner.pos;                                                           // 200
    var result;                                                                           // 201
    if ((result = BlazeTools.parseNumber(scanner))) {                                     // 202
      return ['NUMBER', result.value];                                                    // 203
    } else if ((result = BlazeTools.parseStringLiteral(scanner))) {                       // 204
      return ['STRING', result.value];                                                    // 205
    } else if (/^[\.\[]/.test(scanner.peek())) {                                          // 206
      return ['PATH', scanPath()];                                                        // 207
    } else if ((result = BlazeTools.parseIdentifierName(scanner))) {                      // 208
      var id = result;                                                                    // 209
      if (id === 'null') {                                                                // 210
        return ['NULL', null];                                                            // 211
      } else if (id === 'true' || id === 'false') {                                       // 212
        return ['BOOLEAN', id === 'true'];                                                // 213
      } else {                                                                            // 214
        scanner.pos = startPos; // unconsume `id`                                         // 215
        return ['PATH', scanPath()];                                                      // 216
      }                                                                                   // 217
    } else {                                                                              // 218
      expected('identifier, number, string, boolean, or null');                           // 219
    }                                                                                     // 220
  };                                                                                      // 221
                                                                                          // 222
  var type;                                                                               // 223
                                                                                          // 224
  var error = function (msg) {                                                            // 225
    scanner.fatal(msg);                                                                   // 226
  };                                                                                      // 227
                                                                                          // 228
  var expected = function (what) {                                                        // 229
    error('Expected ' + what);                                                            // 230
  };                                                                                      // 231
                                                                                          // 232
  // must do ELSE first; order of others doesn't matter                                   // 233
                                                                                          // 234
  if (run(starts.ELSE)) type = 'ELSE';                                                    // 235
  else if (run(starts.DOUBLE)) type = 'DOUBLE';                                           // 236
  else if (run(starts.TRIPLE)) type = 'TRIPLE';                                           // 237
  else if (run(starts.BLOCKCOMMENT)) type = 'BLOCKCOMMENT';                               // 238
  else if (run(starts.COMMENT)) type = 'COMMENT';                                         // 239
  else if (run(starts.INCLUSION)) type = 'INCLUSION';                                     // 240
  else if (run(starts.BLOCKOPEN)) type = 'BLOCKOPEN';                                     // 241
  else if (run(starts.BLOCKCLOSE)) type = 'BLOCKCLOSE';                                   // 242
  else                                                                                    // 243
    error('Unknown stache tag');                                                          // 244
                                                                                          // 245
  var tag = new TemplateTag;                                                              // 246
  tag.type = type;                                                                        // 247
                                                                                          // 248
  if (type === 'BLOCKCOMMENT') {                                                          // 249
    var result = run(/^[\s\S]*?--\s*?\}\}/);                                              // 250
    if (! result)                                                                         // 251
      error("Unclosed block comment");                                                    // 252
    tag.value = result.slice(0, result.lastIndexOf('--'));                                // 253
  } else if (type === 'COMMENT') {                                                        // 254
    var result = run(/^[\s\S]*?\}\}/);                                                    // 255
    if (! result)                                                                         // 256
      error("Unclosed comment");                                                          // 257
    tag.value = result.slice(0, -2);                                                      // 258
  } else if (type === 'BLOCKCLOSE') {                                                     // 259
    tag.path = scanPath();                                                                // 260
    if (! run(ends.DOUBLE))                                                               // 261
      expected('`}}`');                                                                   // 262
  } else if (type === 'ELSE') {                                                           // 263
    if (! run(ends.DOUBLE))                                                               // 264
      expected('`}}`');                                                                   // 265
  } else {                                                                                // 266
    // DOUBLE, TRIPLE, BLOCKOPEN, INCLUSION                                               // 267
    tag.path = scanPath();                                                                // 268
    tag.args = [];                                                                        // 269
    var foundKwArg = false;                                                               // 270
    while (true) {                                                                        // 271
      run(/^\s*/);                                                                        // 272
      if (type === 'TRIPLE') {                                                            // 273
        if (run(ends.TRIPLE))                                                             // 274
          break;                                                                          // 275
        else if (scanner.peek() === '}')                                                  // 276
          expected('`}}}`');                                                              // 277
      } else {                                                                            // 278
        if (run(ends.DOUBLE))                                                             // 279
          break;                                                                          // 280
        else if (scanner.peek() === '}')                                                  // 281
          expected('`}}`');                                                               // 282
      }                                                                                   // 283
      var newArg = scanArg();                                                             // 284
      if (newArg.length === 3) {                                                          // 285
        foundKwArg = true;                                                                // 286
      } else {                                                                            // 287
        if (foundKwArg)                                                                   // 288
          error("Can't have a non-keyword argument after a keyword argument");            // 289
      }                                                                                   // 290
      tag.args.push(newArg);                                                              // 291
                                                                                          // 292
      if (run(/^(?=[\s}])/) !== '')                                                       // 293
        expected('space');                                                                // 294
    }                                                                                     // 295
  }                                                                                       // 296
                                                                                          // 297
  return tag;                                                                             // 298
};                                                                                        // 299
                                                                                          // 300
// Returns a SpacebarsCompiler.TemplateTag parsed from `scanner`, leaving scanner         // 301
// at its original position.                                                              // 302
//                                                                                        // 303
// An error will still be thrown if there is not a valid template tag at                  // 304
// the current position.                                                                  // 305
TemplateTag.peek = function (scanner) {                                                   // 306
  var startPos = scanner.pos;                                                             // 307
  var result = TemplateTag.parse(scanner);                                                // 308
  scanner.pos = startPos;                                                                 // 309
  return result;                                                                          // 310
};                                                                                        // 311
                                                                                          // 312
// Like `TemplateTag.parse`, but in the case of blocks, parse the complete                // 313
// `{{#foo}}...{{/foo}}` with `content` and possible `elseContent`, rather                // 314
// than just the BLOCKOPEN tag.                                                           // 315
//                                                                                        // 316
// In addition:                                                                           // 317
//                                                                                        // 318
// - Throws an error if `{{else}}` or `{{/foo}}` tag is encountered.                      // 319
//                                                                                        // 320
// - Returns `null` for a COMMENT.  (This case is distinguishable from                    // 321
//   parsing no tag by the fact that the scanner is advanced.)                            // 322
//                                                                                        // 323
// - Takes an HTMLTools.TEMPLATE_TAG_POSITION `position` and sets it as the               // 324
//   TemplateTag's `.position` property.                                                  // 325
//                                                                                        // 326
// - Validates the tag's well-formedness and legality at in its position.                 // 327
TemplateTag.parseCompleteTag = function (scannerOrString, position) {                     // 328
  var scanner = scannerOrString;                                                          // 329
  if (typeof scanner === 'string')                                                        // 330
    scanner = new HTMLTools.Scanner(scannerOrString);                                     // 331
                                                                                          // 332
  var startPos = scanner.pos; // for error messages                                       // 333
  var result = TemplateTag.parse(scannerOrString);                                        // 334
  if (! result)                                                                           // 335
    return result;                                                                        // 336
                                                                                          // 337
  if (result.type === 'BLOCKCOMMENT')                                                     // 338
    return null;                                                                          // 339
                                                                                          // 340
  if (result.type === 'COMMENT')                                                          // 341
    return null;                                                                          // 342
                                                                                          // 343
  if (result.type === 'ELSE')                                                             // 344
    scanner.fatal("Unexpected {{else}}");                                                 // 345
                                                                                          // 346
  if (result.type === 'BLOCKCLOSE')                                                       // 347
    scanner.fatal("Unexpected closing template tag");                                     // 348
                                                                                          // 349
  position = (position || TEMPLATE_TAG_POSITION.ELEMENT);                                 // 350
  if (position !== TEMPLATE_TAG_POSITION.ELEMENT)                                         // 351
    result.position = position;                                                           // 352
                                                                                          // 353
  if (result.type === 'BLOCKOPEN') {                                                      // 354
    // parse block contents                                                               // 355
                                                                                          // 356
    // Construct a string version of `.path` for comparing start and                      // 357
    // end tags.  For example, `foo/[0]` was parsed into `["foo", "0"]`                   // 358
    // and now becomes `foo,0`.  This form may also show up in error                      // 359
    // messages.                                                                          // 360
    var blockName = result.path.join(',');                                                // 361
                                                                                          // 362
    var textMode = null;                                                                  // 363
      if (blockName === 'markdown' ||                                                     // 364
          position === TEMPLATE_TAG_POSITION.IN_RAWTEXT) {                                // 365
        textMode = HTML.TEXTMODE.STRING;                                                  // 366
      } else if (position === TEMPLATE_TAG_POSITION.IN_RCDATA ||                          // 367
                 position === TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {                       // 368
        textMode = HTML.TEXTMODE.RCDATA;                                                  // 369
      }                                                                                   // 370
      var parserOptions = {                                                               // 371
        getTemplateTag: TemplateTag.parseCompleteTag,                                     // 372
        shouldStop: isAtBlockCloseOrElse,                                                 // 373
        textMode: textMode                                                                // 374
      };                                                                                  // 375
    result.content = HTMLTools.parseFragment(scanner, parserOptions);                     // 376
                                                                                          // 377
    if (scanner.rest().slice(0, 2) !== '{{')                                              // 378
      scanner.fatal("Expected {{else}} or block close for " + blockName);                 // 379
                                                                                          // 380
    var lastPos = scanner.pos; // save for error messages                                 // 381
    var tmplTag = TemplateTag.parse(scanner); // {{else}} or {{/foo}}                     // 382
                                                                                          // 383
    if (tmplTag.type === 'ELSE') {                                                        // 384
      // parse {{else}} and content up to close tag                                       // 385
      result.elseContent = HTMLTools.parseFragment(scanner, parserOptions);               // 386
                                                                                          // 387
      if (scanner.rest().slice(0, 2) !== '{{')                                            // 388
        scanner.fatal("Expected block close for " + blockName);                           // 389
                                                                                          // 390
      lastPos = scanner.pos;                                                              // 391
      tmplTag = TemplateTag.parse(scanner);                                               // 392
    }                                                                                     // 393
                                                                                          // 394
    if (tmplTag.type === 'BLOCKCLOSE') {                                                  // 395
      var blockName2 = tmplTag.path.join(',');                                            // 396
      if (blockName !== blockName2) {                                                     // 397
        scanner.pos = lastPos;                                                            // 398
        scanner.fatal('Expected tag to close ' + blockName + ', found ' +                 // 399
                      blockName2);                                                        // 400
      }                                                                                   // 401
    } else {                                                                              // 402
      scanner.pos = lastPos;                                                              // 403
      scanner.fatal('Expected tag to close ' + blockName + ', found ' +                   // 404
                    tmplTag.type);                                                        // 405
    }                                                                                     // 406
  }                                                                                       // 407
                                                                                          // 408
  var finalPos = scanner.pos;                                                             // 409
  scanner.pos = startPos;                                                                 // 410
  validateTag(result, scanner);                                                           // 411
  scanner.pos = finalPos;                                                                 // 412
                                                                                          // 413
  return result;                                                                          // 414
};                                                                                        // 415
                                                                                          // 416
var isAtBlockCloseOrElse = function (scanner) {                                           // 417
  // Detect `{{else}}` or `{{/foo}}`.                                                     // 418
  //                                                                                      // 419
  // We do as much work ourselves before deferring to `TemplateTag.peek`,                 // 420
  // for efficiency (we're called for every input token) and to be                        // 421
  // less obtrusive, because `TemplateTag.peek` will throw an error if it                 // 422
  // sees `{{` followed by a malformed tag.                                               // 423
  var rest, type;                                                                         // 424
  return (scanner.peek() === '{' &&                                                       // 425
          (rest = scanner.rest()).slice(0, 2) === '{{' &&                                 // 426
          /^\{\{\s*(\/|else\b)/.test(rest) &&                                             // 427
          (type = TemplateTag.peek(scanner).type) &&                                      // 428
          (type === 'BLOCKCLOSE' || type === 'ELSE'));                                    // 429
};                                                                                        // 430
                                                                                          // 431
// Validate that `templateTag` is correctly formed and legal for its                      // 432
// HTML position.  Use `scanner` to report errors. On success, does                       // 433
// nothing.                                                                               // 434
var validateTag = function (ttag, scanner) {                                              // 435
                                                                                          // 436
  if (ttag.type === 'INCLUSION' || ttag.type === 'BLOCKOPEN') {                           // 437
    var args = ttag.args;                                                                 // 438
    if (args.length > 1 && args[0].length === 2 && args[0][0] !== 'PATH') {               // 439
      // we have a positional argument that is not a PATH followed by                     // 440
      // other arguments                                                                  // 441
      scanner.fatal("First argument must be a function, to be called on the rest of the arguments; found " + args[0][0]);
    }                                                                                     // 443
  }                                                                                       // 444
                                                                                          // 445
  var position = ttag.position || TEMPLATE_TAG_POSITION.ELEMENT;                          // 446
  if (position === TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {                                  // 447
    if (ttag.type === 'DOUBLE') {                                                         // 448
      return;                                                                             // 449
    } else if (ttag.type === 'BLOCKOPEN') {                                               // 450
      var path = ttag.path;                                                               // 451
      var path0 = path[0];                                                                // 452
      if (! (path.length === 1 && (path0 === 'if' ||                                      // 453
                                   path0 === 'unless' ||                                  // 454
                                   path0 === 'with' ||                                    // 455
                                   path0 === 'each'))) {                                  // 456
        scanner.fatal("Custom block helpers are not allowed in an HTML attribute, only built-in ones like #each and #if");
      }                                                                                   // 458
    } else {                                                                              // 459
      scanner.fatal(ttag.type + " template tag is not allowed in an HTML attribute");     // 460
    }                                                                                     // 461
  } else if (position === TEMPLATE_TAG_POSITION.IN_START_TAG) {                           // 462
    if (! (ttag.type === 'DOUBLE')) {                                                     // 463
      scanner.fatal("Reactive HTML attributes must either have a constant name or consist of a single {{helper}} providing a dictionary of names and values.  A template tag of type " + ttag.type + " is not allowed here.");
    }                                                                                     // 465
    if (scanner.peek() === '=') {                                                         // 466
      scanner.fatal("Template tags are not allowed in attribute names, only in attribute values or in the form of a single {{helper}} that evaluates to a dictionary of name=value pairs.");
    }                                                                                     // 468
  }                                                                                       // 469
                                                                                          // 470
};                                                                                        // 471
                                                                                          // 472
////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                        //
// packages/spacebars-compiler/optimizer.js                                               //
//                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////
                                                                                          //
// Optimize parts of an HTMLjs tree into raw HTML strings when they don't                 // 1
// contain template tags.                                                                 // 2
                                                                                          // 3
var constant = function (value) {                                                         // 4
  return function () { return value; };                                                   // 5
};                                                                                        // 6
                                                                                          // 7
var OPTIMIZABLE = {                                                                       // 8
  NONE: 0,                                                                                // 9
  PARTS: 1,                                                                               // 10
  FULL: 2                                                                                 // 11
};                                                                                        // 12
                                                                                          // 13
// We can only turn content into an HTML string if it contains no template                // 14
// tags and no "tricky" HTML tags.  If we can optimize the entire content                 // 15
// into a string, we return OPTIMIZABLE.FULL.  If the we are given an                     // 16
// unoptimizable node, we return OPTIMIZABLE.NONE.  If we are given a tree                // 17
// that contains an unoptimizable node somewhere, we return OPTIMIZABLE.PARTS.            // 18
//                                                                                        // 19
// For example, we always create SVG elements programmatically, since SVG                 // 20
// doesn't have innerHTML.  If we are given an SVG element, we return NONE.               // 21
// However, if we are given a big tree that contains SVG somewhere, we                    // 22
// return PARTS so that the optimizer can descend into the tree and optimize              // 23
// other parts of it.                                                                     // 24
var CanOptimizeVisitor = HTML.Visitor.extend();                                           // 25
CanOptimizeVisitor.def({                                                                  // 26
  visitNull: constant(OPTIMIZABLE.FULL),                                                  // 27
  visitPrimitive: constant(OPTIMIZABLE.FULL),                                             // 28
  visitComment: constant(OPTIMIZABLE.FULL),                                               // 29
  visitCharRef: constant(OPTIMIZABLE.FULL),                                               // 30
  visitRaw: constant(OPTIMIZABLE.FULL),                                                   // 31
  visitObject: constant(OPTIMIZABLE.NONE),                                                // 32
  visitFunction: constant(OPTIMIZABLE.NONE),                                              // 33
  visitArray: function (x) {                                                              // 34
    for (var i = 0; i < x.length; i++)                                                    // 35
      if (this.visit(x[i]) !== OPTIMIZABLE.FULL)                                          // 36
        return OPTIMIZABLE.PARTS;                                                         // 37
    return OPTIMIZABLE.FULL;                                                              // 38
  },                                                                                      // 39
  visitTag: function (tag) {                                                              // 40
    var tagName = tag.tagName;                                                            // 41
    if (tagName === 'textarea') {                                                         // 42
      // optimizing into a TEXTAREA's RCDATA would require being a little                 // 43
      // more clever.                                                                     // 44
      return OPTIMIZABLE.NONE;                                                            // 45
    } else if (! (HTML.isKnownElement(tagName) &&                                         // 46
                  ! HTML.isKnownSVGElement(tagName))) {                                   // 47
      // foreign elements like SVG can't be stringified for innerHTML.                    // 48
      return OPTIMIZABLE.NONE;                                                            // 49
    } else if (tagName === 'table') {                                                     // 50
      // Avoid ever producing HTML containing `<table><tr>...`, because the               // 51
      // browser will insert a TBODY.  If we just `createElement("table")` and            // 52
      // `createElement("tr")`, on the other hand, no TBODY is necessary                  // 53
      // (assuming IE 8+).                                                                // 54
      return OPTIMIZABLE.NONE;                                                            // 55
    }                                                                                     // 56
                                                                                          // 57
    var children = tag.children;                                                          // 58
    for (var i = 0; i < children.length; i++)                                             // 59
      if (this.visit(children[i]) !== OPTIMIZABLE.FULL)                                   // 60
        return OPTIMIZABLE.PARTS;                                                         // 61
                                                                                          // 62
    if (this.visitAttributes(tag.attrs) !== OPTIMIZABLE.FULL)                             // 63
      return OPTIMIZABLE.PARTS;                                                           // 64
                                                                                          // 65
    return OPTIMIZABLE.FULL;                                                              // 66
  },                                                                                      // 67
  visitAttributes: function (attrs) {                                                     // 68
    if (attrs) {                                                                          // 69
      var isArray = HTML.isArray(attrs);                                                  // 70
      for (var i = 0; i < (isArray ? attrs.length : 1); i++) {                            // 71
        var a = (isArray ? attrs[i] : attrs);                                             // 72
        if ((typeof a !== 'object') || (a instanceof HTMLTools.TemplateTag))              // 73
          return OPTIMIZABLE.PARTS;                                                       // 74
        for (var k in a)                                                                  // 75
          if (this.visit(a[k]) !== OPTIMIZABLE.FULL)                                      // 76
            return OPTIMIZABLE.PARTS;                                                     // 77
      }                                                                                   // 78
    }                                                                                     // 79
    return OPTIMIZABLE.FULL;                                                              // 80
  }                                                                                       // 81
});                                                                                       // 82
                                                                                          // 83
var getOptimizability = function (content) {                                              // 84
  return (new CanOptimizeVisitor).visit(content);                                         // 85
};                                                                                        // 86
                                                                                          // 87
var toRaw = function (x) {                                                                // 88
  return HTML.Raw(HTML.toHTML(x));                                                        // 89
};                                                                                        // 90
                                                                                          // 91
var TreeTransformer = HTML.TransformingVisitor.extend();                                  // 92
TreeTransformer.def({                                                                     // 93
  visitAttributes: function (attrs/*, ...*/) {                                            // 94
    // pass template tags through by default                                              // 95
    if (attrs instanceof HTMLTools.TemplateTag)                                           // 96
      return attrs;                                                                       // 97
                                                                                          // 98
    return HTML.TransformingVisitor.prototype.visitAttributes.apply(                      // 99
      this, arguments);                                                                   // 100
  }                                                                                       // 101
});                                                                                       // 102
                                                                                          // 103
// Replace parts of the HTMLjs tree that have no template tags (or                        // 104
// tricky HTML tags) with HTML.Raw objects containing raw HTML.                           // 105
var OptimizingVisitor = TreeTransformer.extend();                                         // 106
OptimizingVisitor.def({                                                                   // 107
  visitNull: toRaw,                                                                       // 108
  visitPrimitive: toRaw,                                                                  // 109
  visitComment: toRaw,                                                                    // 110
  visitCharRef: toRaw,                                                                    // 111
  visitArray: function (array) {                                                          // 112
    var optimizability = getOptimizability(array);                                        // 113
    if (optimizability === OPTIMIZABLE.FULL) {                                            // 114
      return toRaw(array);                                                                // 115
    } else if (optimizability === OPTIMIZABLE.PARTS) {                                    // 116
      return TreeTransformer.prototype.visitArray.call(this, array);                      // 117
    } else {                                                                              // 118
      return array;                                                                       // 119
    }                                                                                     // 120
  },                                                                                      // 121
  visitTag: function (tag) {                                                              // 122
    var optimizability = getOptimizability(tag);                                          // 123
    if (optimizability === OPTIMIZABLE.FULL) {                                            // 124
      return toRaw(tag);                                                                  // 125
    } else if (optimizability === OPTIMIZABLE.PARTS) {                                    // 126
      return TreeTransformer.prototype.visitTag.call(this, tag);                          // 127
    } else {                                                                              // 128
      return tag;                                                                         // 129
    }                                                                                     // 130
  },                                                                                      // 131
  visitChildren: function (children) {                                                    // 132
    // don't optimize the children array into a Raw object!                               // 133
    return TreeTransformer.prototype.visitArray.call(this, children);                     // 134
  },                                                                                      // 135
  visitAttributes: function (attrs) {                                                     // 136
    return attrs;                                                                         // 137
  }                                                                                       // 138
});                                                                                       // 139
                                                                                          // 140
// Combine consecutive HTML.Raws.  Remove empty ones.                                     // 141
var RawCompactingVisitor = TreeTransformer.extend();                                      // 142
RawCompactingVisitor.def({                                                                // 143
  visitArray: function (array) {                                                          // 144
    var result = [];                                                                      // 145
    for (var i = 0; i < array.length; i++) {                                              // 146
      var item = array[i];                                                                // 147
      if ((item instanceof HTML.Raw) &&                                                   // 148
          ((! item.value) ||                                                              // 149
           (result.length &&                                                              // 150
            (result[result.length - 1] instanceof HTML.Raw)))) {                          // 151
        // two cases: item is an empty Raw, or previous item is                           // 152
        // a Raw as well.  In the latter case, replace the previous                       // 153
        // Raw with a longer one that includes the new Raw.                               // 154
        if (item.value) {                                                                 // 155
          result[result.length - 1] = HTML.Raw(                                           // 156
            result[result.length - 1].value + item.value);                                // 157
        }                                                                                 // 158
      } else {                                                                            // 159
        result.push(item);                                                                // 160
      }                                                                                   // 161
    }                                                                                     // 162
    return result;                                                                        // 163
  }                                                                                       // 164
});                                                                                       // 165
                                                                                          // 166
// Replace pointless Raws like `HTMl.Raw('foo')` that contain no special                  // 167
// characters with simple strings.                                                        // 168
var RawReplacingVisitor = TreeTransformer.extend();                                       // 169
RawReplacingVisitor.def({                                                                 // 170
  visitRaw: function (raw) {                                                              // 171
    var html = raw.value;                                                                 // 172
    if (html.indexOf('&') < 0 && html.indexOf('<') < 0) {                                 // 173
      return html;                                                                        // 174
    } else {                                                                              // 175
      return raw;                                                                         // 176
    }                                                                                     // 177
  }                                                                                       // 178
});                                                                                       // 179
                                                                                          // 180
SpacebarsCompiler.optimize = function (tree) {                                            // 181
  tree = (new OptimizingVisitor).visit(tree);                                             // 182
  tree = (new RawCompactingVisitor).visit(tree);                                          // 183
  tree = (new RawReplacingVisitor).visit(tree);                                           // 184
  return tree;                                                                            // 185
};                                                                                        // 186
                                                                                          // 187
////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                        //
// packages/spacebars-compiler/codegen.js                                                 //
//                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////
                                                                                          //
// ============================================================                           // 1
// Code-generation of template tags                                                       // 2
                                                                                          // 3
// The `CodeGen` class currently has no instance state, but in theory                     // 4
// it could be useful to track per-function state, like whether we                        // 5
// need to emit `var self = this` or not.                                                 // 6
var CodeGen = SpacebarsCompiler.CodeGen = function () {};                                 // 7
                                                                                          // 8
var builtInBlockHelpers = SpacebarsCompiler._builtInBlockHelpers = {                      // 9
  'if': 'Blaze.If',                                                                       // 10
  'unless': 'Blaze.Unless',                                                               // 11
  'with': 'Spacebars.With',                                                               // 12
  'each': 'Blaze.Each'                                                                    // 13
};                                                                                        // 14
                                                                                          // 15
                                                                                          // 16
// Some `UI.*` paths are special in that they generate code that                          // 17
 // doesn't folow the normal lookup rules for dotted symbols. The                         // 18
 // following names must be prefixed with `UI.` when you use them in a                    // 19
 // template.                                                                             // 20
var builtInUIPaths = {                                                                    // 21
  // `template` is a local variable defined in the generated render                       // 22
  // function for the template in which `UI.contentBlock` (or                             // 23
  // `UI.elseBlock`) is invoked. `template` is a reference to the                         // 24
  // template itself.                                                                     // 25
  'contentBlock': 'view.templateContentBlock',                                            // 26
  'elseBlock': 'view.templateElseBlock',                                                  // 27
                                                                                          // 28
  // `Template` is the global template namespace. If you define a                         // 29
  // template named `foo` in Spacebars, it gets defined as                                // 30
  // `Template.foo` in JavaScript.                                                        // 31
  'dynamic': 'Template.__dynamic'                                                         // 32
};                                                                                        // 33
                                                                                          // 34
// A "reserved name" can't be used as a <template> name.  This                            // 35
// function is used by the template file scanner.                                         // 36
SpacebarsCompiler.isReservedName = function (name) {                                      // 37
  return builtInBlockHelpers.hasOwnProperty(name);                                        // 38
};                                                                                        // 39
                                                                                          // 40
var makeObjectLiteral = function (obj) {                                                  // 41
  var parts = [];                                                                         // 42
  for (var k in obj)                                                                      // 43
    parts.push(BlazeTools.toObjectLiteralKey(k) + ': ' + obj[k]);                         // 44
  return '{' + parts.join(', ') + '}';                                                    // 45
};                                                                                        // 46
                                                                                          // 47
_.extend(CodeGen.prototype, {                                                             // 48
  codeGenTemplateTag: function (tag) {                                                    // 49
    var self = this;                                                                      // 50
    if (tag.position === HTMLTools.TEMPLATE_TAG_POSITION.IN_START_TAG) {                  // 51
      // Special dynamic attributes: `<div {{attrs}}>...`                                 // 52
      // only `tag.type === 'DOUBLE'` allowed (by earlier validation)                     // 53
      return BlazeTools.EmitCode('function () { return ' +                                // 54
          self.codeGenMustache(tag.path, tag.args, 'attrMustache')                        // 55
          + '; }');                                                                       // 56
    } else {                                                                              // 57
      if (tag.type === 'DOUBLE' || tag.type === 'TRIPLE') {                               // 58
        var code = self.codeGenMustache(tag.path, tag.args);                              // 59
        if (tag.type === 'TRIPLE') {                                                      // 60
          code = 'Spacebars.makeRaw(' + code + ')';                                       // 61
        }                                                                                 // 62
        if (tag.position !== HTMLTools.TEMPLATE_TAG_POSITION.IN_ATTRIBUTE) {              // 63
          // Reactive attributes are already wrapped in a function,                       // 64
          // and there's no fine-grained reactivity.                                      // 65
          // Anywhere else, we need to create a View.                                     // 66
          code = 'Blaze.View(function () { return ' + code + '; })';                      // 67
        }                                                                                 // 68
        return BlazeTools.EmitCode(code);                                                 // 69
      } else if (tag.type === 'INCLUSION' || tag.type === 'BLOCKOPEN') {                  // 70
        var path = tag.path;                                                              // 71
                                                                                          // 72
        if (tag.type === 'BLOCKOPEN' &&                                                   // 73
            builtInBlockHelpers.hasOwnProperty(path[0])) {                                // 74
          // if, unless, with, each.                                                      // 75
          //                                                                              // 76
          // If someone tries to do `{{> if}}`, we don't                                  // 77
          // get here, but an error is thrown when we try to codegen the path.            // 78
                                                                                          // 79
          // Note: If we caught these errors earlier, while scanning, we'd be able to     // 80
          // provide nice line numbers.                                                   // 81
          if (path.length > 1)                                                            // 82
            throw new Error("Unexpected dotted path beginning with " + path[0]);          // 83
          if (! tag.args.length)                                                          // 84
            throw new Error("#" + path[0] + " requires an argument");                     // 85
                                                                                          // 86
          // `args` must exist (tag.args.length > 0)                                      // 87
          var dataCode = self.codeGenInclusionDataFunc(tag.args) || 'null';               // 88
          // `content` must exist                                                         // 89
          var contentBlock = (('content' in tag) ?                                        // 90
                              self.codeGenBlock(tag.content) : null);                     // 91
          // `elseContent` may not exist                                                  // 92
          var elseContentBlock = (('elseContent' in tag) ?                                // 93
                                  self.codeGenBlock(tag.elseContent) : null);             // 94
                                                                                          // 95
          var callArgs = [dataCode, contentBlock];                                        // 96
          if (elseContentBlock)                                                           // 97
            callArgs.push(elseContentBlock);                                              // 98
                                                                                          // 99
          return BlazeTools.EmitCode(                                                     // 100
            builtInBlockHelpers[path[0]] + '(' + callArgs.join(', ') + ')');              // 101
                                                                                          // 102
        } else {                                                                          // 103
          var compCode = self.codeGenPath(path, {lookupTemplate: true});                  // 104
          if (path.length > 1) {                                                          // 105
            // capture reactivity                                                         // 106
            compCode = 'function () { return Spacebars.call(' + compCode +                // 107
              '); }';                                                                     // 108
          }                                                                               // 109
                                                                                          // 110
          var dataCode = self.codeGenInclusionDataFunc(tag.args);                         // 111
          var content = (('content' in tag) ?                                             // 112
                         self.codeGenBlock(tag.content) : null);                          // 113
          var elseContent = (('elseContent' in tag) ?                                     // 114
                             self.codeGenBlock(tag.elseContent) : null);                  // 115
                                                                                          // 116
          var includeArgs = [compCode];                                                   // 117
          if (content) {                                                                  // 118
            includeArgs.push(content);                                                    // 119
            if (elseContent)                                                              // 120
              includeArgs.push(elseContent);                                              // 121
          }                                                                               // 122
                                                                                          // 123
          var includeCode =                                                               // 124
                'Spacebars.include(' + includeArgs.join(', ') + ')';                      // 125
                                                                                          // 126
          // calling convention compat -- set the data context around the                 // 127
          // entire inclusion, so that if the name of the inclusion is                    // 128
          // a helper function, it gets the data context in `this`.                       // 129
          // This makes for a pretty confusing calling convention --                      // 130
          // In `{{#foo bar}}`, `foo` is evaluated in the context of `bar`                // 131
          // -- but it's what we shipped for 0.8.0.  The rationale is that                // 132
          // `{{#foo bar}}` is sugar for `{{#with bar}}{{#foo}}...`.                      // 133
          if (dataCode) {                                                                 // 134
            includeCode =                                                                 // 135
              'Blaze._TemplateWith(' + dataCode + ', function () { return ' +             // 136
              includeCode + '; })';                                                       // 137
          }                                                                               // 138
                                                                                          // 139
          if (path[0] === 'UI' &&                                                         // 140
              (path[1] === 'contentBlock' || path[1] === 'elseBlock')) {                  // 141
            includeCode = 'Blaze._InOuterTemplateScope(view, function () { return '       // 142
              + includeCode + '; })';                                                     // 143
          }                                                                               // 144
                                                                                          // 145
          return BlazeTools.EmitCode(includeCode);                                        // 146
        }                                                                                 // 147
      } else {                                                                            // 148
        // Can't get here; TemplateTag validation should catch any                        // 149
        // inappropriate tag types that might come out of the parser.                     // 150
        throw new Error("Unexpected template tag type: " + tag.type);                     // 151
      }                                                                                   // 152
    }                                                                                     // 153
  },                                                                                      // 154
                                                                                          // 155
  // `path` is an array of at least one string.                                           // 156
  //                                                                                      // 157
  // If `path.length > 1`, the generated code may be reactive                             // 158
  // (i.e. it may invalidate the current computation).                                    // 159
  //                                                                                      // 160
  // No code is generated to call the result if it's a function.                          // 161
  //                                                                                      // 162
  // Options:                                                                             // 163
  //                                                                                      // 164
  // - lookupTemplate {Boolean} If true, generated code also looks in                     // 165
  //   the list of templates. (After helpers, before data context).                       // 166
  //   Used when generating code for `{{> foo}}` or `{{#foo}}`. Only                      // 167
  //   used for non-dotted paths.                                                         // 168
  codeGenPath: function (path, opts) {                                                    // 169
    if (builtInBlockHelpers.hasOwnProperty(path[0]))                                      // 170
      throw new Error("Can't use the built-in '" + path[0] + "' here");                   // 171
    // Let `{{#if UI.contentBlock}}` check whether this template was invoked via          // 172
    // inclusion or as a block helper, in addition to supporting                          // 173
    // `{{> UI.contentBlock}}`.                                                           // 174
    if (path.length >= 2 &&                                                               // 175
        path[0] === 'UI' && builtInUIPaths.hasOwnProperty(path[1])) {                     // 176
      if (path.length > 2)                                                                // 177
        throw new Error("Unexpected dotted path beginning with " +                        // 178
                        path[0] + '.' + path[1]);                                         // 179
      return builtInUIPaths[path[1]];                                                     // 180
    }                                                                                     // 181
                                                                                          // 182
    var firstPathItem = BlazeTools.toJSLiteral(path[0]);                                  // 183
    var lookupMethod = 'lookup';                                                          // 184
    if (opts && opts.lookupTemplate && path.length === 1)                                 // 185
      lookupMethod = 'lookupTemplate';                                                    // 186
    var code = 'view.' + lookupMethod + '(' + firstPathItem + ')';                        // 187
                                                                                          // 188
    if (path.length > 1) {                                                                // 189
      code = 'Spacebars.dot(' + code + ', ' +                                             // 190
        _.map(path.slice(1), BlazeTools.toJSLiteral).join(', ') + ')';                    // 191
    }                                                                                     // 192
                                                                                          // 193
    return code;                                                                          // 194
  },                                                                                      // 195
                                                                                          // 196
  // Generates code for an `[argType, argValue]` argument spec,                           // 197
  // ignoring the third element (keyword argument name) if present.                       // 198
  //                                                                                      // 199
  // The resulting code may be reactive (in the case of a PATH of                         // 200
  // more than one element) and is not wrapped in a closure.                              // 201
  codeGenArgValue: function (arg) {                                                       // 202
    var self = this;                                                                      // 203
                                                                                          // 204
    var argType = arg[0];                                                                 // 205
    var argValue = arg[1];                                                                // 206
                                                                                          // 207
    var argCode;                                                                          // 208
    switch (argType) {                                                                    // 209
    case 'STRING':                                                                        // 210
    case 'NUMBER':                                                                        // 211
    case 'BOOLEAN':                                                                       // 212
    case 'NULL':                                                                          // 213
      argCode = BlazeTools.toJSLiteral(argValue);                                         // 214
      break;                                                                              // 215
    case 'PATH':                                                                          // 216
      argCode = self.codeGenPath(argValue);                                               // 217
      break;                                                                              // 218
    default:                                                                              // 219
      // can't get here                                                                   // 220
      throw new Error("Unexpected arg type: " + argType);                                 // 221
    }                                                                                     // 222
                                                                                          // 223
    return argCode;                                                                       // 224
  },                                                                                      // 225
                                                                                          // 226
  // Generates a call to `Spacebars.fooMustache` on evaluated arguments.                  // 227
  // The resulting code has no function literals and must be wrapped in                   // 228
  // one for fine-grained reactivity.                                                     // 229
  codeGenMustache: function (path, args, mustacheType) {                                  // 230
    var self = this;                                                                      // 231
                                                                                          // 232
    var nameCode = self.codeGenPath(path);                                                // 233
    var argCode = self.codeGenMustacheArgs(args);                                         // 234
    var mustache = (mustacheType || 'mustache');                                          // 235
                                                                                          // 236
    return 'Spacebars.' + mustache + '(' + nameCode +                                     // 237
      (argCode ? ', ' + argCode.join(', ') : '') + ')';                                   // 238
  },                                                                                      // 239
                                                                                          // 240
  // returns: array of source strings, or null if no                                      // 241
  // args at all.                                                                         // 242
  codeGenMustacheArgs: function (tagArgs) {                                               // 243
    var self = this;                                                                      // 244
                                                                                          // 245
    var kwArgs = null; // source -> source                                                // 246
    var args = null; // [source]                                                          // 247
                                                                                          // 248
    // tagArgs may be null                                                                // 249
    _.each(tagArgs, function (arg) {                                                      // 250
      var argCode = self.codeGenArgValue(arg);                                            // 251
                                                                                          // 252
      if (arg.length > 2) {                                                               // 253
        // keyword argument (represented as [type, value, name])                          // 254
        kwArgs = (kwArgs || {});                                                          // 255
        kwArgs[arg[2]] = argCode;                                                         // 256
      } else {                                                                            // 257
        // positional argument                                                            // 258
        args = (args || []);                                                              // 259
        args.push(argCode);                                                               // 260
      }                                                                                   // 261
    });                                                                                   // 262
                                                                                          // 263
    // put kwArgs in options dictionary at end of args                                    // 264
    if (kwArgs) {                                                                         // 265
      args = (args || []);                                                                // 266
      args.push('Spacebars.kw(' + makeObjectLiteral(kwArgs) + ')');                       // 267
    }                                                                                     // 268
                                                                                          // 269
    return args;                                                                          // 270
  },                                                                                      // 271
                                                                                          // 272
  codeGenBlock: function (content) {                                                      // 273
    return SpacebarsCompiler.codeGen(content);                                            // 274
  },                                                                                      // 275
                                                                                          // 276
  codeGenInclusionDataFunc: function (args) {                                             // 277
    var self = this;                                                                      // 278
                                                                                          // 279
    var dataFuncCode = null;                                                              // 280
                                                                                          // 281
    if (! args.length) {                                                                  // 282
      // e.g. `{{#foo}}`                                                                  // 283
      return null;                                                                        // 284
    } else if (args[0].length === 3) {                                                    // 285
      // keyword arguments only, e.g. `{{> point x=1 y=2}}`                               // 286
      var dataProps = {};                                                                 // 287
      _.each(args, function (arg) {                                                       // 288
        var argKey = arg[2];                                                              // 289
        dataProps[argKey] = 'Spacebars.call(' + self.codeGenArgValue(arg) + ')';          // 290
      });                                                                                 // 291
      dataFuncCode = makeObjectLiteral(dataProps);                                        // 292
    } else if (args[0][0] !== 'PATH') {                                                   // 293
      // literal first argument, e.g. `{{> foo "blah"}}`                                  // 294
      //                                                                                  // 295
      // tag validation has confirmed, in this case, that there is only                   // 296
      // one argument (`args.length === 1`)                                               // 297
      dataFuncCode = self.codeGenArgValue(args[0]);                                       // 298
    } else if (args.length === 1) {                                                       // 299
      // one argument, must be a PATH                                                     // 300
      dataFuncCode = 'Spacebars.call(' + self.codeGenPath(args[0][1]) + ')';              // 301
    } else {                                                                              // 302
      // Multiple positional arguments; treat them as a nested                            // 303
      // "data mustache"                                                                  // 304
      dataFuncCode = self.codeGenMustache(args[0][1], args.slice(1),                      // 305
                                          'dataMustache');                                // 306
    }                                                                                     // 307
                                                                                          // 308
    return 'function () { return ' + dataFuncCode + '; }';                                // 309
  }                                                                                       // 310
                                                                                          // 311
});                                                                                       // 312
                                                                                          // 313
////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);






(function () {

////////////////////////////////////////////////////////////////////////////////////////////
//                                                                                        //
// packages/spacebars-compiler/compiler.js                                                //
//                                                                                        //
////////////////////////////////////////////////////////////////////////////////////////////
                                                                                          //
                                                                                          // 1
SpacebarsCompiler.parse = function (input) {                                              // 2
                                                                                          // 3
  var tree = HTMLTools.parseFragment(                                                     // 4
    input,                                                                                // 5
    { getTemplateTag: TemplateTag.parseCompleteTag });                                    // 6
                                                                                          // 7
  return tree;                                                                            // 8
};                                                                                        // 9
                                                                                          // 10
SpacebarsCompiler.compile = function (input, options) {                                   // 11
  var tree = SpacebarsCompiler.parse(input);                                              // 12
  return SpacebarsCompiler.codeGen(tree, options);                                        // 13
};                                                                                        // 14
                                                                                          // 15
SpacebarsCompiler._TemplateTagReplacer = HTML.TransformingVisitor.extend();               // 16
SpacebarsCompiler._TemplateTagReplacer.def({                                              // 17
  visitObject: function (x) {                                                             // 18
    if (x instanceof HTMLTools.TemplateTag) {                                             // 19
                                                                                          // 20
      // Make sure all TemplateTags in attributes have the right                          // 21
      // `.position` set on them.  This is a bit of a hack                                // 22
      // (we shouldn't be mutating that here), but it allows                              // 23
      // cleaner codegen of "synthetic" attributes like TEXTAREA's                        // 24
      // "value", where the template tags were originally not                             // 25
      // in an attribute.                                                                 // 26
      if (this.inAttributeValue)                                                          // 27
        x.position = HTMLTools.TEMPLATE_TAG_POSITION.IN_ATTRIBUTE;                        // 28
                                                                                          // 29
      return this.codegen.codeGenTemplateTag(x);                                          // 30
    }                                                                                     // 31
                                                                                          // 32
    return HTML.TransformingVisitor.prototype.visitObject.call(this, x);                  // 33
  },                                                                                      // 34
  visitAttributes: function (attrs) {                                                     // 35
    if (attrs instanceof HTMLTools.TemplateTag)                                           // 36
      return this.codegen.codeGenTemplateTag(attrs);                                      // 37
                                                                                          // 38
    // call super (e.g. for case where `attrs` is an array)                               // 39
    return HTML.TransformingVisitor.prototype.visitAttributes.call(this, attrs);          // 40
  },                                                                                      // 41
  visitAttribute: function (name, value, tag) {                                           // 42
    this.inAttributeValue = true;                                                         // 43
    var result = this.visit(value);                                                       // 44
    this.inAttributeValue = false;                                                        // 45
                                                                                          // 46
    if (result !== value) {                                                               // 47
      // some template tags must have been replaced, because otherwise                    // 48
      // we try to keep things `===` when transforming.  Wrap the code                    // 49
      // in a function as per the rules.  You can't have                                  // 50
      // `{id: Blaze.View(...)}` as an attributes dict because the View                   // 51
      // would be rendered more than once; you need to wrap it in a function              // 52
      // so that it's a different View each time.                                         // 53
      return BlazeTools.EmitCode(this.codegen.codeGenBlock(result));                      // 54
    }                                                                                     // 55
    return result;                                                                        // 56
  }                                                                                       // 57
});                                                                                       // 58
                                                                                          // 59
SpacebarsCompiler.codeGen = function (parseTree, options) {                               // 60
  // is this a template, rather than a block passed to                                    // 61
  // a block helper, say                                                                  // 62
  var isTemplate = (options && options.isTemplate);                                       // 63
  var isBody = (options && options.isBody);                                               // 64
                                                                                          // 65
  var tree = parseTree;                                                                   // 66
                                                                                          // 67
  // The flags `isTemplate` and `isBody` are kind of a hack.                              // 68
  if (isTemplate || isBody) {                                                             // 69
    // optimizing fragments would require being smarter about whether we are              // 70
    // in a TEXTAREA, say.                                                                // 71
    tree = SpacebarsCompiler.optimize(tree);                                              // 72
  }                                                                                       // 73
                                                                                          // 74
  var codegen = new SpacebarsCompiler.CodeGen;                                            // 75
  tree = (new SpacebarsCompiler._TemplateTagReplacer(                                     // 76
    {codegen: codegen})).visit(tree);                                                     // 77
                                                                                          // 78
  var code = '(function () { ';                                                           // 79
  if (isTemplate || isBody) {                                                             // 80
    code += 'var view = this; ';                                                          // 81
  }                                                                                       // 82
  code += 'return ';                                                                      // 83
  code += BlazeTools.toJS(tree);                                                          // 84
  code += '; })';                                                                         // 85
                                                                                          // 86
  code = SpacebarsCompiler._beautify(code);                                               // 87
                                                                                          // 88
  return code;                                                                            // 89
};                                                                                        // 90
                                                                                          // 91
SpacebarsCompiler._beautify = function (code) {                                           // 92
  if (Package.minifiers && Package.minifiers.UglifyJSMinify) {                            // 93
    var result = UglifyJSMinify(code,                                                     // 94
                                { fromString: true,                                       // 95
                                  mangle: false,                                          // 96
                                  compress: false,                                        // 97
                                  output: { beautify: true,                               // 98
                                            indent_level: 2,                              // 99
                                            width: 80 } });                               // 100
    var output = result.code;                                                             // 101
    // Uglify interprets our expression as a statement and may add a semicolon.           // 102
    // Strip trailing semicolon.                                                          // 103
    output = output.replace(/;$/, '');                                                    // 104
    return output;                                                                        // 105
  } else {                                                                                // 106
    // don't actually beautify; no UglifyJS                                               // 107
    return code;                                                                          // 108
  }                                                                                       // 109
};                                                                                        // 110
                                                                                          // 111
////////////////////////////////////////////////////////////////////////////////////////////

}).call(this);


/* Exports */
if (typeof Package === 'undefined') Package = {};
Package['spacebars-compiler'] = {
  SpacebarsCompiler: SpacebarsCompiler
};

})();
