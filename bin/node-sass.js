#!/usr/bin/env node
'use strict';

/**
 * This file is a modified version of the original node-sass executable found here:
 * https://github.com/sass/node-sass/blob/master/bin/node-sass
 *
 * It has been modified to use chokidar instead of Gaze when watching directories and files.
 */

var Emitter = require('events').EventEmitter;
var forEach = require('async-foreach').forEach;
var chokidar = require('chokidar');
var grapher = require('sass-graph');
var meow = require('meow');
var util = require('util');
var path = require('path');
var glob = require('glob');
var stdout = require('stdout-stream');
var stdin = require('get-stdin');
var fs = require('fs');

var compile = require('sass.js/dist/sass.node');
var render = function render(options, emitter) {
  var src = options.src,
      outputStyle = options.outputStyle,
      omitSourceMapUrl = options.omitSourceMapUrl,
      sourceMap = options.sourceMap,
      sourceMapRoot = options.sourceMapRoot,
      sourceMapEmbed = options.sourceMapEmbed,
      sourceMapContents = options.sourceMapContents,
      dest = options.dest,
      indentType = options.indentType,
      indentWidth = options.indentWidth,
      indentedSyntax = options.indentedSyntax,
      quiet = options.quiet,
      linefeed = options.linefeed,
      sourceComments = options.sourceComments;


  var linefeedMap = {
    cr: '\r',
    crlf: '\r\n',
    lf: '\n',
    lfcr: '\n\r'
  };

  var compileOptions = {
    style: compile.Sass.style[outputStyle || 'nested'],
    sourceMapRoot: sourceMapRoot,
    sourceMapEmbed: sourceMapEmbed,
    sourceMapContents: sourceMapContents,
    sourceMapOmitUrl: omitSourceMapUrl,
    indent: ''.padEnd(indentWidth || 2, indentType === 'tab' ? '\t' : ' '),
    indentedSyntax: indentedSyntax,
    linefeed: linefeedMap[linefeed] || '\n',
    comments: sourceComments
  };
  compile.Sass.options('defaults');
  var file = src.replace(process.cwd() + '/', '');

  compile(file, compileOptions, function (result) {
    if (result.status === 0) {
      fs.writeFileSync(dest, result.text);
      if (sourceMap) {
        fs.writeFileSync(sourceMap, JSON.stringify(result.map));
      }
    } else {
      if (!quiet) console.log(result);
    }
  });
};

/**
 * Initialize CLI
 */

var cli = meow({
  pkg: '../package.json',
  help: ['Usage:', '  node-sass.js [options] <input.scss>', '  cat <input.scss> | node-sass.js [options] > output.css', '', 'Example: Compile foobar.scss to foobar.css', '  node-sass.js --output-style compressed foobar.scss > foobar.css', '  cat foobar.scss | node-sass.js --output-style compressed > foobar.css', '', 'Example: Watch the sass directory for changes, compile with sourcemaps to the css directory', '  node-sass.js --watch --output css', '    --source-map true --source-map-contents sass', '', 'Options', '  -w, --watch                Watch a directory or file', '  -m, --match-regex          Only watches files in a directory that match the regular expression', '  -o, --output               Output directory', '  -x, --omit-source-map-url  Omit source map URL comment from output', '  -i, --indented-syntax      Treat data from stdin as sass code (versus scss)', '  -q, --quiet                Suppress log output except on error', '  -v, --version              Prints version info', '  --skip-initial             Skips initial build when passing the --watch flag', '  --output-style             CSS output style (nested | expanded | compact | compressed)', '  --indent-type              Indent type for output CSS (space | tab)', '  --indent-width             Indent width; number of spaces or tabs (maximum value: 10)', '  --linefeed                 Linefeed style (cr | crlf | lf | lfcr)', '  --source-comments          Include debug info in output', '  --source-map               Emit source map', '  --source-map-contents      Embed include contents in map', '  --source-map-embed         Embed sourceMappingUrl as data URI', '  --source-map-root          Base path, will be emitted in source-map as is', '  --include-path             Path to look for imported files', '  --follow                   Follow symlinked directories', '  --precision                The amount of precision allowed in decimal numbers', '  --error-bell               Output a bell character on errors', '  --importer                 Path to .js file containing custom importer', '  --functions                Path to .js file containing custom functions', '  --use-polling              Watch using polling (chokidars\'s polling option)', '  --polling-interval         Interval of filesystem folling if polling is being used', '  --help                     Print usage info'].join('\n')
}, {
  boolean: ['error-bell', 'follow', 'use-polling', 'indented-syntax', 'omit-source-map-url', 'quiet', 'skip-initial', 'source-map-embed', 'source-map-contents', 'source-comments', 'watch'],
  string: ['functions', 'importer', 'include-path', 'indent-type', 'linefeed', 'output', 'output-style', 'precision', 'source-map-root', 'match-regex', 'polling-interval'],
  alias: {
    c: 'source-comments',
    i: 'indented-syntax',
    q: 'quiet',
    o: 'output',
    x: 'omit-source-map-url',
    v: 'version',
    w: 'watch'
  },
  default: {
    'include-path': process.cwd(),
    'indent-type': 'space',
    'indent-width': 2,
    linefeed: 'lf',
    'output-style': 'nested',
    precision: 5,
    quiet: false,
    'use-polling': false,
    'skip-initial': false,
    'polling-interval': 100
  }
});

/**
 * Is a Directory
 *
 * @param {String} filePath
 * @returns {Boolean}
 * @api private
 */

function isDirectory(filePath) {
  var isDir = false;
  try {
    var absolutePath = path.resolve(filePath);
    isDir = fs.statSync(absolutePath).isDirectory();
  } catch (e) {
    isDir = e.code === 'ENOENT';
  }
  return isDir;
}

/**
 * Create emitter
 *
 * @api private
 */

function getEmitter() {
  var emitter = new Emitter();

  emitter.on('error', function (err) {
    if (options.errorBell) {
      err += '\x07';
    }
    console.error(err);
    if (!options.watch) {
      process.exit(1);
    }
  });

  emitter.on('warn', function (data) {
    if (!options.quiet) {
      console.warn(data);
    }
  });

  emitter.on('log', stdout.write.bind(stdout));

  return emitter;
}

/**
 * Construct options
 *
 * @param {Array} arguments
 * @param {Object} options
 * @api private
 */

function getOptions(args, options) {
  var cssDir, sassDir, file, mapDir;
  options.src = args[0];

  // Instead of removing `recursive` altogether I am setting it to true for back-compatibility
  // options.recursive = true;

  if (args[1]) {
    options.dest = path.resolve(args[1]);
  } else if (options.output) {
    options.dest = path.join(path.resolve(options.output), [path.basename(options.src, path.extname(options.src)), '.css'].join('')); // replace ext.
  }

  if (options.directory) {
    sassDir = path.resolve(options.directory);
    file = path.relative(sassDir, args[0]);
    cssDir = path.resolve(options.output);
    options.dest = path.join(cssDir, file).replace(path.extname(file), '.css');
  }

  if (options.sourceMap) {
    if (!options.sourceMapOriginal) {
      options.sourceMapOriginal = options.sourceMap;
    }

    // check if sourceMap path ends with .map to avoid isDirectory false-positive
    var sourceMapIsDirectory = options.sourceMapOriginal.indexOf('.map', options.sourceMapOriginal.length - 4) === -1 && isDirectory(options.sourceMapOriginal);

    if (options.sourceMapOriginal === 'true') {
      options.sourceMap = options.dest + '.map';
    } else if (!sourceMapIsDirectory) {
      options.sourceMap = path.resolve(options.sourceMapOriginal);
    } else if (sourceMapIsDirectory) {
      if (!options.directory) {
        options.sourceMap = path.resolve(options.sourceMapOriginal, path.basename(options.dest) + '.map');
      } else {
        sassDir = path.resolve(options.directory);
        file = path.relative(sassDir, args[0]);
        mapDir = path.resolve(options.sourceMapOriginal);
        options.sourceMap = path.join(mapDir, file).replace(path.extname(file), '.css.map');
      }
    }
  }
  return options;
}

function passesRegex(options, file) {
  if (options.matchRegex) {
    var fileName = file.split('/');
    fileName = fileName[fileName.length - 1];
    var reg = RegExp(options.matchRegex);
    if (!reg.test(fileName)) {
      return false;
    }
  }
  return true;
}

/**
 * Watch
 *
 * @param {Object} options
 * @param {Object} emitter
 * @api private
 */

function watch(options, emitter) {
  var buildGraph = function buildGraph(options) {
    var graph;
    var graphOptions = {
      loadPaths: options.includePath,
      extensions: ['scss', 'sass']
    };

    if (options.directory) {
      graph = grapher.parseDir(options.directory, graphOptions);
    } else {
      graph = grapher.parseFile(options.src, graphOptions);
    }

    return graph;
  };

  var graph = buildGraph(options);

  var paths = [];
  if (options.directory) {
    paths.push(path.resolve(options.directory, '**/*.{sass,scss}'));
  }

  for (var i in graph.index) {
    paths.push(i);
  }

  var watcher = chokidar.watch(paths, {
    followSymlinks: options.follow,
    usePolling: options.usePolling,
    interval: +options.pollingInterval,
    ignoreInitial: options.skipInitial
  });

  /* eslint handle-callback-err: "off" */
  watcher.on('error', function (error) {
    emitter.emit.bind(emitter, 'error');
  });

  function changeHandler(file) {
    if (!passesRegex(options, file)) {
      return;
    }
    var files = [file];

    // descendents may be added, so we need a new graph
    graph = buildGraph(options);
    graph.visitAncestors(file, function (parent) {
      files.push(parent);
    });

    // Add children to watcher
    graph.visitDescendents(file, function (child) {
      if (paths.indexOf(child) === -1) {
        paths.push(child);
        watcher.add(child);
      }
    });

    files.forEach(function (file) {
      if (path.basename(file)[0] !== '_' && passesRegex(options, file)) {
        if (options.directory) {
          if (file.indexOf(path.resolve(options.directory)) !== -1) {
            renderFile(file, options, emitter);
          }
        } else {
          if (file.indexOf(path.resolve(options.src)) !== -1) {
            renderFile(file, options, emitter);
          }
        }
      }
    });
  }

  watcher.on('change', changeHandler).on('add', function (file) {
    if (path.basename(file)[0] !== '_' && passesRegex(options, file)) {
      if (options.directory) {
        if (file.indexOf(path.resolve(options.directory)) !== -1) {
          renderFile(file, options, emitter);
        }
      } else if (file.indexOf(path.resolve(options.src)) !== -1) {
        renderFile(file, options, emitter);
      }
    }
  });
}

/**
 * Run
 *
 * @param {Object} options
 * @param {Object} emitter
 * @api private
 */

function run(options, emitter) {
  if (!Array.isArray(options.includePath)) {
    options.includePath = [options.includePath];
  }

  if (options.directory) {
    if (!options.output) {
      emitter.emit('error', 'An output directory must be specified when compiling a directory');
    }
    if (!isDirectory(options.output)) {
      emitter.emit('error', 'An output directory must be specified when compiling a directory');
    }
  }

  if (options.sourceMapOriginal && options.directory && !isDirectory(options.sourceMapOriginal) && options.sourceMapOriginal !== 'true') {
    emitter.emit('error', 'The --source-map option must be either a boolean or directory when compiling a directory');
  }

  /* eslint no-useless-escape: "off" */
  if (options.importer) {
    if (path.resolve(options.importer) === path.normalize(options.importer).replace(/(.+)([\/|\\])$/, '$1')) {
      options.importer = require(options.importer);
    } else {
      options.importer = require(path.resolve(options.importer));
    }
  }

  if (options.functions) {
    if (path.resolve(options.functions) === path.normalize(options.functions).replace(/(.+)([\/|\\])$/, '$1')) {
      options.functions = require(options.functions);
    } else {
      options.functions = require(path.resolve(options.functions));
    }
  }

  if (options.watch) {
    watch(options, emitter);
  } else if (options.directory) {
    renderDir(options, emitter);
  } else {
    render(options, emitter);
  }
}

/**
 * Render a file
 *
 * @param {String} file
 * @param {Object} options
 * @param {Object} emitter
 * @api private
 */
function renderFile(file, options, emitter) {
  options = getOptions([path.resolve(file)], options);
  if (options.watch) {
    emitter.emit('warn', util.format('=> changed: %s', file));
  }
  if (passesRegex(options, file)) {
    render(options, emitter);
  }
}

/**
 * Render all sass files in a directory
 *
 * @param {Object} options
 * @param {Object} emitter
 * @api private
 */
function renderDir(options, emitter) {
  var globPath = path.resolve(options.directory, '**/*.{sass,scss}');
  glob(globPath, { ignore: '**/_*', follow: options.follow }, function (err, files) {
    if (err) {
      return emitter.emit('error', util.format('You do not have permission to access this path: %s.', err.path));
    } else if (!files.length) {
      return emitter.emit('warn', 'No input files were found.');
    }

    forEach(files, function (subject) {
      emitter.once('done', this.async());
      if (passesRegex(options, subject)) {
        renderFile(subject, options, emitter);
      }
    }, function (successful, arr) {
      var outputDir = path.join(process.cwd(), options.output);
      emitter.emit('warn', util.format('Wrote %s CSS files to %s', arr.length, outputDir));
      process.exit();
    });
  });
}

/**
 * Arguments and options
 */

var options = getOptions(cli.input, cli.flags);
var emitter = getEmitter();

/**
 * Show usage if no arguments are supplied
 */

if (!options.src && process.stdin.isTTY) {
  emitter.emit('error', ['Provide a Sass file to render', '', 'Example: Compile foobar.scss to foobar.css', '  node-sass.js --output-style compressed foobar.scss > foobar.css', '  cat foobar.scss | node-sass.js --output-style compressed > foobar.css', '', 'Example: Watch the sass directory for changes, compile with sourcemaps to the css directory', '  node-sass.js --watch --output css', '    --source-map true --source-map-contents sass'].join('\n'));
}

/**
 * Apply arguments
 */

if (options.src) {
  if (isDirectory(options.src)) {
    options.directory = options.src;
  }
  run(options, emitter);
} else if (!process.stdin.isTTY) {
  stdin(function (data) {
    options.data = data;
    options.stdin = true;
    run(options, emitter);
  });
}