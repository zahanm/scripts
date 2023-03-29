/*
 * @noformat
 *
 * require-format.js fails due to https://github.com/nodejs/node/issues/11258
 * */

"use strict";

/*
 * How to run this script
 *
 * If necessary, reserve and set up a devvm (https://our.intern.facebook.com/intern/devservers)
 * If necessary, sudo feature install ig_devserver && ig-clone base
 * Set up a proxy for npm: https://fburl.com/ann8uxpk
 * cd ~/instagram-server/resources/ig_npm_modules/print-emoji-regexps
 * npm install
 * node print_emoji_regexps.js
 */

const path = require("path");
const regenerate = require("regenerate");
const regExpTrie = require("regex-trie");
const request = require("request");
const s = require("underscore.string");
require("string.fromcodepoint");

const EMOJI_DATA_URL =
  "http://www.unicode.org/Public/emoji/15.0/emoji-test.txt";

function getRanges(array) {
  array = array.concat().sort();
  const ranges = [];
  let rstart, rend;
  for (let i = 0; i < array.length; i++) {
    rstart = array[i];
    rend = rstart;
    while (array[i + 1] - array[i] == 1) {
      rend = array[i + 1]; // increment the index if the numbers sequential
      i++;
    }
    ranges.push(rstart == rend ? [rstart] : [rstart, rend]);
  }
  return ranges;
}

function javaEscape(codePoint) {
  return "\\\\x{" + codePoint.toString(16) + "}";
}

function objectiveCEscape(codePoint) {
  const string = String.fromCodePoint(codePoint);
  if (/^[.*+?^=!:${}()|[\]/\\]$/.test(string)) {
    return "\\\\" + string;
  }
  if (codePoint >= 32 && codePoint < 128) {
    return "\\x" + s.lpad(codePoint.toString(16), 2, "0");
  }
  if (codePoint < 0x10000) {
    return "\\u" + s.lpad(codePoint.toString(16), 4, "0");
  } else {
    return "\\U" + s.lpad(codePoint.toString(16), 8, "0");
  }
}

function eightByteCharRange(singleCodePoints, escFn) {
  const ranges = getRanges(singleCodePoints)
    .map(function (range) {
      if (range.length == 1) {
        return escFn(range[0]);
      } else if (range[0] == range[1] - 1) {
        return escFn(range[0]) + escFn(range[1]);
      } else {
        return escFn(range[0]) + "-" + escFn(range[1]);
      }
    })
    .join("");

  return "[" + ranges + "]";
}

function eightByteDoubles(doublePoints, escFn) {
  return Object.keys(doublePoints)
    .map(function (k) {
      const firstPoint = parseInt(k, 10); // gets stringified in map
      const secondPoints = doublePoints[k];
      if (secondPoints.length == 1) {
        return escFn(firstPoint) + escFn(secondPoints[0]);
      } else {
        return escFn(firstPoint) + eightByteCharRange(secondPoints, escFn);
      }
    })
    .join("|");
}

function utf16Singles(singlePoints) {
  const ret = regenerate();
  singlePoints.forEach(function (pt) {
    ret.add(pt);
  });
  return ret.toString();
}

function utf16Doubles(doublePoints) {
  const regexTrie = regExpTrie();
  Object.keys(doublePoints).forEach(function (k) {
    const firstPoint = parseInt(k, 10); // gets stringified in map
    const secondPoints = doublePoints[k];
    secondPoints.forEach(function (secondPoint) {
      regexTrie.add(
        String.fromCodePoint.apply(null, [firstPoint, secondPoint])
      );
    });
  });
  return regexTrie.toString().replace(/(\\[^xu])/g, "\\$1");
}

function parsePoints(body) {
  const singlePoints = [];
  // first -> second (like a trie)
  const doublePoints = {};

  s.lines(body).forEach(function (line) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) {
      return;
    }

    const cols = line.split(";").map(function (e) {
      return e.trim();
    });
    if (cols.length <= 1) {
      return;
    }

    const codePoints = cols[0].split(/\s+/).map(function (hexString) {
      return parseInt(hexString, 16);
    });

    if (codePoints.length == 1) {
      singlePoints.push(codePoints[0]);
    } else if (codePoints.length == 2) {
      if (doublePoints[codePoints[0]] === undefined) {
        doublePoints[codePoints[0]] = [];
      }
      doublePoints[codePoints[0]].push(codePoints[1]);
    }
  });

  return {
    single: singlePoints,
    double: doublePoints,
  };
}

function printRegexps(points) {
  // Order matters, have more descriptive emojis earlier
  // and less descriptive emojis later in the script
  const objectiveCRegex =
    eightByteDoubles(points.double, objectiveCEscape) +
    "|" +
    eightByteCharRange(points.single, objectiveCEscape);
  const javaRegex =
    eightByteDoubles(points.double, javaEscape) +
    "|" +
    eightByteCharRange(points.single, javaEscape);
  const utf16Regex =
    utf16Doubles(points.double) + "|" + utf16Singles(points.single);

  console.log("Emoji Regular Expressions!");
  console.log();
  console.log("Python (UTF16 build)");
  console.log('u"' + utf16Regex + '"');
  console.log();
  console.log("Objective C:");
  console.log('@"' + objectiveCRegex + '"');
  console.log();
  console.log("Java 7+");
  console.log('"' + javaRegex + '"');
  console.log();
}

request.get({ url: EMOJI_DATA_URL }, function (error, response, body) {
  if (error) {
    throw error;
  } else if (response.statusCode != 200) {
    throw 'Invalid status code for "' + path + '": ' + response.statusCode;
  }

  printRegexps(parsePoints(body));
});
