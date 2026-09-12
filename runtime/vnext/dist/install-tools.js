import { createRequire } from "node:module";
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// node_modules/fast-fifo/fixed-size.js
var require_fixed_size = __commonJS((exports, module) => {
  module.exports = class FixedFIFO {
    constructor(hwm) {
      if (!(hwm > 0) || (hwm - 1 & hwm) !== 0)
        throw new Error("Max size for a FixedFIFO should be a power of two");
      this.buffer = new Array(hwm);
      this.mask = hwm - 1;
      this.top = 0;
      this.btm = 0;
      this.next = null;
    }
    clear() {
      this.top = this.btm = 0;
      this.next = null;
      this.buffer.fill(undefined);
    }
    push(data) {
      if (this.buffer[this.top] !== undefined)
        return false;
      this.buffer[this.top] = data;
      this.top = this.top + 1 & this.mask;
      return true;
    }
    shift() {
      const last = this.buffer[this.btm];
      if (last === undefined)
        return;
      this.buffer[this.btm] = undefined;
      this.btm = this.btm + 1 & this.mask;
      return last;
    }
    peek() {
      return this.buffer[this.btm];
    }
    isEmpty() {
      return this.buffer[this.btm] === undefined;
    }
  };
});

// node_modules/fast-fifo/index.js
var require_fast_fifo = __commonJS((exports, module) => {
  var FixedFIFO = require_fixed_size();
  module.exports = class FastFIFO {
    constructor(hwm) {
      this.hwm = hwm || 16;
      this.head = new FixedFIFO(this.hwm);
      this.tail = this.head;
      this.length = 0;
    }
    clear() {
      this.head = this.tail;
      this.head.clear();
      this.length = 0;
    }
    push(val) {
      this.length++;
      if (!this.head.push(val)) {
        const prev = this.head;
        this.head = prev.next = new FixedFIFO(2 * this.head.buffer.length);
        this.head.push(val);
      }
    }
    shift() {
      if (this.length !== 0)
        this.length--;
      const val = this.tail.shift();
      if (val === undefined && this.tail.next) {
        const next = this.tail.next;
        this.tail.next = null;
        this.tail = next;
        return this.tail.shift();
      }
      return val;
    }
    peek() {
      const val = this.tail.peek();
      if (val === undefined && this.tail.next)
        return this.tail.next.peek();
      return val;
    }
    isEmpty() {
      return this.length === 0;
    }
  };
});

// node_modules/b4a/index.js
var require_b4a = __commonJS((exports, module) => {
  function isBuffer(value) {
    return Buffer.isBuffer(value) || value instanceof Uint8Array;
  }
  function isEncoding(encoding) {
    return Buffer.isEncoding(encoding);
  }
  function alloc(size, fill2, encoding) {
    return Buffer.alloc(size, fill2, encoding);
  }
  function allocUnsafe(size) {
    return Buffer.allocUnsafe(size);
  }
  function allocUnsafeSlow(size) {
    return Buffer.allocUnsafeSlow(size);
  }
  function byteLength(string, encoding) {
    return Buffer.byteLength(string, encoding);
  }
  function compare(a, b) {
    return Buffer.compare(a, b);
  }
  function concat(buffers, totalLength) {
    return Buffer.concat(buffers, totalLength);
  }
  function copy(source, target, targetStart, start, end) {
    return toBuffer(source).copy(target, targetStart, start, end);
  }
  function equals(a, b) {
    return toBuffer(a).equals(b);
  }
  function fill(buffer, value, offset, end, encoding) {
    return toBuffer(buffer).fill(value, offset, end, encoding);
  }
  function from(value, encodingOrOffset, length) {
    return Buffer.from(value, encodingOrOffset, length);
  }
  function includes(buffer, value, byteOffset, encoding) {
    return toBuffer(buffer).includes(value, byteOffset, encoding);
  }
  function indexOf(buffer, value, byfeOffset, encoding) {
    return toBuffer(buffer).indexOf(value, byfeOffset, encoding);
  }
  function lastIndexOf(buffer, value, byteOffset, encoding) {
    return toBuffer(buffer).lastIndexOf(value, byteOffset, encoding);
  }
  function swap16(buffer) {
    return toBuffer(buffer).swap16();
  }
  function swap32(buffer) {
    return toBuffer(buffer).swap32();
  }
  function swap64(buffer) {
    return toBuffer(buffer).swap64();
  }
  function toBuffer(buffer) {
    if (Buffer.isBuffer(buffer))
      return buffer;
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  function toString(buffer, encoding, start, end) {
    return toBuffer(buffer).toString(encoding, start, end);
  }
  function write(buffer, string, offset, length, encoding) {
    return toBuffer(buffer).write(string, offset, length, encoding);
  }
  function readDoubleBE(buffer, offset) {
    return toBuffer(buffer).readDoubleBE(offset);
  }
  function readDoubleLE(buffer, offset) {
    return toBuffer(buffer).readDoubleLE(offset);
  }
  function readFloatBE(buffer, offset) {
    return toBuffer(buffer).readFloatBE(offset);
  }
  function readFloatLE(buffer, offset) {
    return toBuffer(buffer).readFloatLE(offset);
  }
  function readInt32BE(buffer, offset) {
    return toBuffer(buffer).readInt32BE(offset);
  }
  function readInt32LE(buffer, offset) {
    return toBuffer(buffer).readInt32LE(offset);
  }
  function readUInt32BE(buffer, offset) {
    return toBuffer(buffer).readUInt32BE(offset);
  }
  function readUInt32LE(buffer, offset) {
    return toBuffer(buffer).readUInt32LE(offset);
  }
  function writeDoubleBE(buffer, value, offset) {
    return toBuffer(buffer).writeDoubleBE(value, offset);
  }
  function writeDoubleLE(buffer, value, offset) {
    return toBuffer(buffer).writeDoubleLE(value, offset);
  }
  function writeFloatBE(buffer, value, offset) {
    return toBuffer(buffer).writeFloatBE(value, offset);
  }
  function writeFloatLE(buffer, value, offset) {
    return toBuffer(buffer).writeFloatLE(value, offset);
  }
  function writeInt32BE(buffer, value, offset) {
    return toBuffer(buffer).writeInt32BE(value, offset);
  }
  function writeInt32LE(buffer, value, offset) {
    return toBuffer(buffer).writeInt32LE(value, offset);
  }
  function writeUInt32BE(buffer, value, offset) {
    return toBuffer(buffer).writeUInt32BE(value, offset);
  }
  function writeUInt32LE(buffer, value, offset) {
    return toBuffer(buffer).writeUInt32LE(value, offset);
  }
  module.exports = {
    isBuffer,
    isEncoding,
    alloc,
    allocUnsafe,
    allocUnsafeSlow,
    byteLength,
    compare,
    concat,
    copy,
    equals,
    fill,
    from,
    includes,
    indexOf,
    lastIndexOf,
    swap16,
    swap32,
    swap64,
    toBuffer,
    toString,
    write,
    readDoubleBE,
    readDoubleLE,
    readFloatBE,
    readFloatLE,
    readInt32BE,
    readInt32LE,
    readUInt32BE,
    readUInt32LE,
    writeDoubleBE,
    writeDoubleLE,
    writeFloatBE,
    writeFloatLE,
    writeInt32BE,
    writeInt32LE,
    writeUInt32BE,
    writeUInt32LE
  };
});

// node_modules/text-decoder/lib/pass-through-decoder.js
var require_pass_through_decoder = __commonJS((exports, module) => {
  var b4a = require_b4a();
  module.exports = class PassThroughDecoder {
    constructor(encoding) {
      this.encoding = encoding;
    }
    get remaining() {
      return 0;
    }
    decode(data) {
      return b4a.toString(data, this.encoding);
    }
    flush() {
      return "";
    }
  };
});

// node_modules/text-decoder/lib/utf8-decoder.js
var require_utf8_decoder = __commonJS((exports, module) => {
  var b4a = require_b4a();
  module.exports = class UTF8Decoder {
    constructor() {
      this._reset();
    }
    get remaining() {
      return this.bytesSeen;
    }
    decode(data) {
      if (data.byteLength === 0)
        return "";
      if (this.bytesNeeded === 0 && trailingIncomplete(data, 0) === 0) {
        this.bytesSeen = trailingBytesSeen(data);
        return b4a.toString(data, "utf8");
      }
      let result = "";
      let start = 0;
      if (this.bytesNeeded > 0) {
        while (start < data.byteLength) {
          const byte = data[start];
          if (byte < this.lowerBoundary || byte > this.upperBoundary) {
            result += "�";
            this._reset();
            break;
          }
          this.lowerBoundary = 128;
          this.upperBoundary = 191;
          this.codePoint = this.codePoint << 6 | byte & 63;
          this.bytesSeen++;
          start++;
          if (this.bytesSeen === this.bytesNeeded) {
            result += String.fromCodePoint(this.codePoint);
            this._reset();
            break;
          }
        }
        if (this.bytesNeeded > 0)
          return result;
      }
      const trailing = trailingIncomplete(data, start);
      const end = data.byteLength - trailing;
      if (end > start)
        result += b4a.toString(data, "utf8", start, end);
      for (let i2 = end;i2 < data.byteLength; i2++) {
        const byte = data[i2];
        if (this.bytesNeeded === 0) {
          if (byte <= 127) {
            this.bytesSeen = 0;
            result += String.fromCharCode(byte);
          } else if (byte >= 194 && byte <= 223) {
            this.bytesNeeded = 2;
            this.bytesSeen = 1;
            this.codePoint = byte & 31;
          } else if (byte >= 224 && byte <= 239) {
            if (byte === 224)
              this.lowerBoundary = 160;
            else if (byte === 237)
              this.upperBoundary = 159;
            this.bytesNeeded = 3;
            this.bytesSeen = 1;
            this.codePoint = byte & 15;
          } else if (byte >= 240 && byte <= 244) {
            if (byte === 240)
              this.lowerBoundary = 144;
            else if (byte === 244)
              this.upperBoundary = 143;
            this.bytesNeeded = 4;
            this.bytesSeen = 1;
            this.codePoint = byte & 7;
          } else {
            this.bytesSeen = 1;
            result += "�";
          }
          continue;
        }
        if (byte < this.lowerBoundary || byte > this.upperBoundary) {
          result += "�";
          i2--;
          this._reset();
          continue;
        }
        this.lowerBoundary = 128;
        this.upperBoundary = 191;
        this.codePoint = this.codePoint << 6 | byte & 63;
        this.bytesSeen++;
        if (this.bytesSeen === this.bytesNeeded) {
          result += String.fromCodePoint(this.codePoint);
          this._reset();
        }
      }
      return result;
    }
    flush() {
      const result = this.bytesNeeded > 0 ? "�" : "";
      this._reset();
      return result;
    }
    _reset() {
      this.codePoint = 0;
      this.bytesNeeded = 0;
      this.bytesSeen = 0;
      this.lowerBoundary = 128;
      this.upperBoundary = 191;
    }
  };
  function trailingIncomplete(data, start) {
    const len = data.byteLength;
    if (len <= start)
      return 0;
    const limit = Math.max(start, len - 4);
    let i2 = len - 1;
    while (i2 > limit && (data[i2] & 192) === 128)
      i2--;
    if (i2 < start)
      return 0;
    const byte = data[i2];
    let needed;
    if (byte <= 127)
      return 0;
    if (byte >= 194 && byte <= 223)
      needed = 2;
    else if (byte >= 224 && byte <= 239)
      needed = 3;
    else if (byte >= 240 && byte <= 244)
      needed = 4;
    else
      return 0;
    const available = len - i2;
    return available < needed ? available : 0;
  }
  function trailingBytesSeen(data) {
    const len = data.byteLength;
    if (len === 0)
      return 0;
    const last = data[len - 1];
    if (last <= 127)
      return 0;
    if ((last & 192) !== 128)
      return 1;
    const limit = Math.max(0, len - 4);
    let i2 = len - 2;
    while (i2 >= limit && (data[i2] & 192) === 128)
      i2--;
    if (i2 < 0)
      return 1;
    const first = data[i2];
    let needed;
    if (first >= 194 && first <= 223)
      needed = 2;
    else if (first >= 224 && first <= 239)
      needed = 3;
    else if (first >= 240 && first <= 244)
      needed = 4;
    else
      return 1;
    if (len - i2 !== needed)
      return 1;
    if (needed >= 3) {
      const second = data[i2 + 1];
      if (first === 224 && second < 160)
        return 1;
      if (first === 237 && second > 159)
        return 1;
      if (first === 240 && second < 144)
        return 1;
      if (first === 244 && second > 143)
        return 1;
    }
    return 0;
  }
});

// node_modules/text-decoder/index.js
var require_text_decoder = __commonJS((exports, module) => {
  var PassThroughDecoder = require_pass_through_decoder();
  var UTF8Decoder = require_utf8_decoder();
  module.exports = class TextDecoder2 {
    constructor(encoding = "utf8") {
      this.encoding = normalizeEncoding(encoding);
      switch (this.encoding) {
        case "utf8":
          this.decoder = new UTF8Decoder;
          break;
        case "utf16le":
        case "base64":
          throw new Error("Unsupported encoding: " + this.encoding);
        default:
          this.decoder = new PassThroughDecoder(this.encoding);
      }
    }
    get remaining() {
      return this.decoder.remaining;
    }
    push(data) {
      if (typeof data === "string")
        return data;
      return this.decoder.decode(data);
    }
    write(data) {
      return this.push(data);
    }
    end(data) {
      let result = "";
      if (data)
        result = this.push(data);
      result += this.decoder.flush();
      return result;
    }
  };
  function normalizeEncoding(encoding) {
    encoding = encoding.toLowerCase();
    switch (encoding) {
      case "utf8":
      case "utf-8":
        return "utf8";
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return "utf16le";
      case "latin1":
      case "binary":
        return "latin1";
      case "base64":
      case "ascii":
      case "hex":
        return encoding;
      default:
        throw new Error("Unknown encoding: " + encoding);
    }
  }
});

// node_modules/streamx/lib/errors.js
var require_errors = __commonJS((exports, module) => {
  module.exports = class StreamError extends Error {
    constructor(msg, code, fn = StreamError) {
      super(msg);
      this.code = code;
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, fn);
      }
    }
    static isStreamDestroyed(err2) {
      return err2 && err2.code === "STREAM_DESTROYED";
    }
    static isPrematureClose(err2) {
      return err2 && err2.code === "PREMATURE_CLOSE";
    }
    static isAborted(err2) {
      return err2 && err2.code === "ABORTED";
    }
    static isBadArgument(err2) {
      return err2 && err2.code === "BAD_ARGUMENT";
    }
    get name() {
      return "StreamError";
    }
    static STREAM_DESTROYED() {
      return new StreamError("Stream was destroyed", "STREAM_DESTROYED", StreamError.STREAM_DESTROYED);
    }
    static PREMATURE_CLOSE(msg = "Premature close") {
      return new StreamError(msg, "PREMATURE_CLOSE", StreamError.PREMATURE_CLOSE);
    }
    static ABORTED() {
      return new StreamError("Stream aborted", "ABORTED", StreamError.ABORTED);
    }
    static BAD_ARGUMENT(msg = "Bad argument") {
      return new StreamError(msg, "BAD_ARGUMENT", StreamError.BAD_ARGUMENT);
    }
  };
});

// node_modules/streamx/index.js
var require_streamx = __commonJS((exports, module) => {
  var { EventEmitter } = __require("events");
  var FIFO = require_fast_fifo();
  var TextDecoder2 = require_text_decoder();
  var StreamError = require_errors();
  var qmt = typeof queueMicrotask === "undefined" ? (fn) => global.process.nextTick(fn) : queueMicrotask;
  var MAX = (1 << 29) - 1;
  var OPENING = 1;
  var PREDESTROYING = 2;
  var DESTROYING = 4;
  var DESTROYED = 8;
  var NOT_OPENING = MAX ^ OPENING;
  var NOT_PREDESTROYING = MAX ^ PREDESTROYING;
  var READ_ACTIVE = 1 << 4;
  var READ_UPDATING = 2 << 4;
  var READ_PRIMARY = 4 << 4;
  var READ_QUEUED = 8 << 4;
  var READ_RESUMED = 16 << 4;
  var READ_PIPE_DRAINED = 32 << 4;
  var READ_ENDING = 64 << 4;
  var READ_EMIT_DATA = 128 << 4;
  var READ_EMIT_READABLE = 256 << 4;
  var READ_EMITTED_READABLE = 512 << 4;
  var READ_DONE = 1024 << 4;
  var READ_NEXT_TICK = 2048 << 4;
  var READ_NEEDS_PUSH = 4096 << 4;
  var READ_READ_AHEAD = 8192 << 4;
  var READ_FLOWING = READ_RESUMED | READ_PIPE_DRAINED;
  var READ_ACTIVE_AND_NEEDS_PUSH = READ_ACTIVE | READ_NEEDS_PUSH;
  var READ_PRIMARY_AND_ACTIVE = READ_PRIMARY | READ_ACTIVE;
  var READ_EMIT_READABLE_AND_QUEUED = READ_EMIT_READABLE | READ_QUEUED;
  var READ_RESUMED_READ_AHEAD = READ_RESUMED | READ_READ_AHEAD;
  var READ_NOT_ACTIVE = MAX ^ READ_ACTIVE;
  var READ_NON_PRIMARY = MAX ^ READ_PRIMARY;
  var READ_NON_PRIMARY_AND_PUSHED = MAX ^ (READ_PRIMARY | READ_NEEDS_PUSH);
  var READ_PUSHED = MAX ^ READ_NEEDS_PUSH;
  var READ_PAUSED = MAX ^ READ_RESUMED;
  var READ_NOT_QUEUED = MAX ^ (READ_QUEUED | READ_EMITTED_READABLE);
  var READ_NOT_ENDING = MAX ^ READ_ENDING;
  var READ_PIPE_NOT_DRAINED = MAX ^ READ_FLOWING;
  var READ_NOT_NEXT_TICK = MAX ^ READ_NEXT_TICK;
  var READ_NOT_UPDATING = MAX ^ READ_UPDATING;
  var READ_NO_READ_AHEAD = MAX ^ READ_READ_AHEAD;
  var READ_PAUSED_NO_READ_AHEAD = MAX ^ READ_RESUMED_READ_AHEAD;
  var WRITE_ACTIVE = 1 << 18;
  var WRITE_UPDATING = 2 << 18;
  var WRITE_PRIMARY = 4 << 18;
  var WRITE_QUEUED = 8 << 18;
  var WRITE_UNDRAINED = 16 << 18;
  var WRITE_DONE = 32 << 18;
  var WRITE_EMIT_DRAIN = 64 << 18;
  var WRITE_NEXT_TICK = 128 << 18;
  var WRITE_WRITING = 256 << 18;
  var WRITE_FINISHING = 512 << 18;
  var WRITE_CORKED = 1024 << 18;
  var WRITE_NOT_ACTIVE = MAX ^ (WRITE_ACTIVE | WRITE_WRITING);
  var WRITE_NON_PRIMARY = MAX ^ WRITE_PRIMARY;
  var WRITE_NOT_FINISHING = MAX ^ (WRITE_ACTIVE | WRITE_FINISHING);
  var WRITE_DRAINED = MAX ^ WRITE_UNDRAINED;
  var WRITE_NOT_QUEUED = MAX ^ WRITE_QUEUED;
  var WRITE_NOT_NEXT_TICK = MAX ^ WRITE_NEXT_TICK;
  var WRITE_NOT_UPDATING = MAX ^ WRITE_UPDATING;
  var WRITE_NOT_CORKED = MAX ^ WRITE_CORKED;
  var ACTIVE = READ_ACTIVE | WRITE_ACTIVE;
  var NOT_ACTIVE = MAX ^ ACTIVE;
  var DONE = READ_DONE | WRITE_DONE;
  var DESTROY_STATUS = DESTROYING | DESTROYED | PREDESTROYING;
  var OPEN_STATUS = DESTROY_STATUS | OPENING;
  var AUTO_DESTROY = DESTROY_STATUS | DONE;
  var NON_PRIMARY = WRITE_NON_PRIMARY & READ_NON_PRIMARY;
  var ACTIVE_OR_TICKING = WRITE_NEXT_TICK | READ_NEXT_TICK;
  var TICKING = ACTIVE_OR_TICKING & NOT_ACTIVE;
  var IS_OPENING = OPEN_STATUS | TICKING;
  var READ_PRIMARY_STATUS = OPEN_STATUS | READ_ENDING | READ_DONE;
  var READ_STATUS = OPEN_STATUS | READ_DONE | READ_QUEUED;
  var READ_ENDING_STATUS = OPEN_STATUS | READ_ENDING | READ_QUEUED;
  var READ_READABLE_STATUS = OPEN_STATUS | READ_EMIT_READABLE | READ_QUEUED | READ_EMITTED_READABLE;
  var SHOULD_NOT_READ = OPEN_STATUS | READ_ACTIVE | READ_ENDING | READ_DONE | READ_NEEDS_PUSH | READ_READ_AHEAD;
  var READ_BACKPRESSURE_STATUS = DESTROY_STATUS | READ_ENDING | READ_DONE;
  var READ_UPDATE_SYNC_STATUS = READ_UPDATING | OPEN_STATUS | READ_NEXT_TICK | READ_PRIMARY;
  var READ_NEXT_TICK_OR_OPENING = READ_NEXT_TICK | OPENING;
  var WRITE_PRIMARY_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_DONE;
  var WRITE_QUEUED_AND_UNDRAINED = WRITE_QUEUED | WRITE_UNDRAINED;
  var WRITE_QUEUED_AND_ACTIVE = WRITE_QUEUED | WRITE_ACTIVE;
  var WRITE_DRAIN_STATUS = WRITE_QUEUED | WRITE_UNDRAINED | OPEN_STATUS | WRITE_ACTIVE;
  var WRITE_STATUS = OPEN_STATUS | WRITE_ACTIVE | WRITE_QUEUED | WRITE_CORKED;
  var WRITE_PRIMARY_AND_ACTIVE = WRITE_PRIMARY | WRITE_ACTIVE;
  var WRITE_ACTIVE_AND_WRITING = WRITE_ACTIVE | WRITE_WRITING;
  var WRITE_FINISHING_STATUS = OPEN_STATUS | WRITE_FINISHING | WRITE_QUEUED_AND_ACTIVE | WRITE_DONE;
  var WRITE_BACKPRESSURE_STATUS = WRITE_UNDRAINED | DESTROY_STATUS | WRITE_FINISHING | WRITE_DONE;
  var WRITE_UPDATE_SYNC_STATUS = WRITE_UPDATING | OPEN_STATUS | WRITE_NEXT_TICK | WRITE_PRIMARY;
  var WRITE_DROP_DATA = WRITE_FINISHING | WRITE_DONE | DESTROY_STATUS;
  var asyncIterator = Symbol.asyncIterator || Symbol("asyncIterator");

  class WritableState {
    constructor(stream, { highWaterMark = 16384, map = null, mapWritable, byteLength, byteLengthWritable } = {}) {
      this.stream = stream;
      this.queue = new FIFO;
      this.highWaterMark = highWaterMark;
      this.buffered = 0;
      this.error = null;
      this.pipeline = null;
      this.drains = null;
      this.byteLength = byteLengthWritable || byteLength || defaultByteLength;
      this.map = mapWritable || map;
      this.afterWrite = afterWrite.bind(this);
      this.afterUpdateNextTick = updateWriteNT.bind(this);
    }
    get ending() {
      return (this.stream._duplexState & WRITE_FINISHING) !== 0;
    }
    get ended() {
      return (this.stream._duplexState & WRITE_DONE) !== 0;
    }
    push(data) {
      if ((this.stream._duplexState & WRITE_DROP_DATA) !== 0)
        return false;
      if (this.map !== null)
        data = this.map(data);
      this.buffered += this.byteLength(data);
      this.queue.push(data);
      if (this.buffered < this.highWaterMark) {
        this.stream._duplexState |= WRITE_QUEUED;
        return true;
      }
      this.stream._duplexState |= WRITE_QUEUED_AND_UNDRAINED;
      return false;
    }
    shift() {
      const data = this.queue.shift();
      this.buffered -= this.byteLength(data);
      if (this.buffered === 0)
        this.stream._duplexState &= WRITE_NOT_QUEUED;
      return data;
    }
    end(data) {
      if (typeof data === "function") {
        this.stream.once("finish", data);
      } else if (data !== undefined && data !== null) {
        this.push(data);
      }
      this.stream._duplexState = (this.stream._duplexState | WRITE_FINISHING) & WRITE_NON_PRIMARY;
    }
    autoBatch(data, cb) {
      const buffer = [];
      const stream = this.stream;
      buffer.push(data);
      while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED_AND_ACTIVE) {
        buffer.push(stream._writableState.shift());
      }
      if ((stream._duplexState & OPEN_STATUS) !== 0)
        return cb(null);
      stream._writev(buffer, cb);
    }
    update() {
      const stream = this.stream;
      stream._duplexState |= WRITE_UPDATING;
      do {
        while ((stream._duplexState & WRITE_STATUS) === WRITE_QUEUED) {
          const data = this.shift();
          stream._duplexState |= WRITE_ACTIVE_AND_WRITING;
          stream._write(data, this.afterWrite);
        }
        if ((stream._duplexState & WRITE_PRIMARY_AND_ACTIVE) === 0)
          this.updateNonPrimary();
      } while (this.continueUpdate() === true);
      stream._duplexState &= WRITE_NOT_UPDATING;
    }
    updateNonPrimary() {
      const stream = this.stream;
      if ((stream._duplexState & WRITE_FINISHING_STATUS) === WRITE_FINISHING) {
        stream._duplexState = stream._duplexState | WRITE_ACTIVE;
        stream._final(afterFinal.bind(this));
        return;
      }
      if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
        if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
          stream._duplexState |= ACTIVE;
          stream._destroy(afterDestroy.bind(this));
        }
        return;
      }
      if ((stream._duplexState & IS_OPENING) === OPENING) {
        stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING;
        stream._open(afterOpen.bind(this));
      }
    }
    continueUpdate() {
      if ((this.stream._duplexState & WRITE_NEXT_TICK) === 0)
        return false;
      this.stream._duplexState &= WRITE_NOT_NEXT_TICK;
      return true;
    }
    updateCallback() {
      if ((this.stream._duplexState & WRITE_UPDATE_SYNC_STATUS) === WRITE_PRIMARY) {
        this.update();
      } else {
        this.updateNextTick();
      }
    }
    updateNextTick() {
      if ((this.stream._duplexState & WRITE_NEXT_TICK) !== 0)
        return;
      this.stream._duplexState |= WRITE_NEXT_TICK;
      if ((this.stream._duplexState & WRITE_UPDATING) === 0)
        qmt(this.afterUpdateNextTick);
    }
  }

  class ReadableState {
    constructor(stream, { highWaterMark = 16384, map = null, mapReadable, byteLength, byteLengthReadable } = {}) {
      this.stream = stream;
      this.queue = new FIFO;
      this.highWaterMark = highWaterMark === 0 ? 1 : highWaterMark;
      this.buffered = 0;
      this.readAhead = highWaterMark > 0;
      this.error = null;
      this.pipeline = null;
      this.byteLength = byteLengthReadable || byteLength || defaultByteLength;
      this.map = mapReadable || map;
      this.pipeTo = null;
      this.afterRead = afterRead.bind(this);
      this.afterUpdateNextTick = updateReadNT.bind(this);
    }
    get ending() {
      return (this.stream._duplexState & READ_ENDING) !== 0;
    }
    get ended() {
      return (this.stream._duplexState & READ_DONE) !== 0;
    }
    pipe(pipeTo, cb) {
      if (this.pipeTo !== null)
        throw StreamError.BAD_ARGUMENT("Can only pipe to one destination");
      if (typeof cb !== "function")
        cb = null;
      this.stream._duplexState |= READ_PIPE_DRAINED;
      this.pipeTo = pipeTo;
      this.pipeline = new Pipeline(this.stream, pipeTo, cb);
      if (cb)
        this.stream.on("error", noop);
      if (isStreamx(pipeTo)) {
        pipeTo._writableState.pipeline = this.pipeline;
        if (cb)
          pipeTo.on("error", noop);
        pipeTo.on("finish", this.pipeline.finished.bind(this.pipeline));
      } else {
        const onerror = this.pipeline.done.bind(this.pipeline, pipeTo);
        const onclose = this.pipeline.done.bind(this.pipeline, pipeTo, null);
        pipeTo.on("error", onerror);
        pipeTo.on("close", onclose);
        pipeTo.on("finish", this.pipeline.finished.bind(this.pipeline));
      }
      pipeTo.on("drain", afterDrain.bind(this));
      this.stream.emit("piping", pipeTo);
      pipeTo.emit("pipe", this.stream);
    }
    push(data) {
      const stream = this.stream;
      if (data === null) {
        this.highWaterMark = 0;
        stream._duplexState = (stream._duplexState | READ_ENDING) & READ_NON_PRIMARY_AND_PUSHED;
        return false;
      }
      if (this.map !== null) {
        data = this.map(data);
        if (data === null) {
          stream._duplexState &= READ_PUSHED;
          return this.buffered < this.highWaterMark;
        }
      }
      this.buffered += this.byteLength(data);
      this.queue.push(data);
      stream._duplexState = (stream._duplexState | READ_QUEUED) & READ_PUSHED;
      return this.buffered < this.highWaterMark;
    }
    shift() {
      const data = this.queue.shift();
      this.buffered -= this.byteLength(data);
      if (this.buffered === 0) {
        this.stream._duplexState &= READ_NOT_QUEUED;
      }
      return data;
    }
    unshift(data) {
      const pending = [this.map !== null ? this.map(data) : data];
      while (this.buffered > 0)
        pending.push(this.shift());
      for (let i2 = 0;i2 < pending.length - 1; i2++) {
        const data2 = pending[i2];
        this.buffered += this.byteLength(data2);
        this.queue.push(data2);
      }
      this.push(pending[pending.length - 1]);
    }
    read() {
      const stream = this.stream;
      if ((stream._duplexState & READ_STATUS) === READ_QUEUED) {
        const data = this.shift();
        if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
          stream._duplexState &= READ_PIPE_NOT_DRAINED;
        }
        if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
          stream.emit("data", data);
        }
        return data;
      }
      if (this.readAhead === false) {
        stream._duplexState |= READ_READ_AHEAD;
        this.updateNextTick();
      }
      return null;
    }
    drain() {
      const stream = this.stream;
      while ((stream._duplexState & READ_STATUS) === READ_QUEUED && (stream._duplexState & READ_FLOWING) !== 0) {
        const data = this.shift();
        if (this.pipeTo !== null && this.pipeTo.write(data) === false) {
          stream._duplexState &= READ_PIPE_NOT_DRAINED;
        }
        if ((stream._duplexState & READ_EMIT_DATA) !== 0) {
          stream.emit("data", data);
        }
      }
    }
    update() {
      const stream = this.stream;
      stream._duplexState |= READ_UPDATING;
      do {
        this.drain();
        while (this.buffered < this.highWaterMark && (stream._duplexState & SHOULD_NOT_READ) === READ_READ_AHEAD) {
          stream._duplexState |= READ_ACTIVE_AND_NEEDS_PUSH;
          stream._read(this.afterRead);
          this.drain();
        }
        if ((stream._duplexState & READ_READABLE_STATUS) === READ_EMIT_READABLE_AND_QUEUED) {
          stream._duplexState |= READ_EMITTED_READABLE;
          stream.emit("readable");
        }
        if ((stream._duplexState & READ_PRIMARY_AND_ACTIVE) === 0) {
          this.updateNonPrimary();
        }
      } while (this.continueUpdate() === true);
      stream._duplexState &= READ_NOT_UPDATING;
    }
    updateNonPrimary() {
      const stream = this.stream;
      if ((stream._duplexState & READ_ENDING_STATUS) === READ_ENDING) {
        stream._duplexState = (stream._duplexState | READ_DONE) & READ_NOT_ENDING;
        stream.emit("end");
        if ((stream._duplexState & AUTO_DESTROY) === DONE) {
          stream._duplexState |= DESTROYING;
        }
        if (this.pipeTo !== null) {
          this.pipeTo.end();
        }
      }
      if ((stream._duplexState & DESTROY_STATUS) === DESTROYING) {
        if ((stream._duplexState & ACTIVE_OR_TICKING) === 0) {
          stream._duplexState |= ACTIVE;
          stream._destroy(afterDestroy.bind(this));
        }
        return;
      }
      if ((stream._duplexState & IS_OPENING) === OPENING) {
        stream._duplexState = (stream._duplexState | ACTIVE) & NOT_OPENING;
        stream._open(afterOpen.bind(this));
      }
    }
    continueUpdate() {
      if ((this.stream._duplexState & READ_NEXT_TICK) === 0)
        return false;
      this.stream._duplexState &= READ_NOT_NEXT_TICK;
      return true;
    }
    updateCallback() {
      if ((this.stream._duplexState & READ_UPDATE_SYNC_STATUS) === READ_PRIMARY) {
        this.update();
      } else {
        this.updateNextTick();
      }
    }
    updateNextTickIfOpen() {
      if ((this.stream._duplexState & READ_NEXT_TICK_OR_OPENING) !== 0)
        return;
      this.stream._duplexState |= READ_NEXT_TICK;
      if ((this.stream._duplexState & READ_UPDATING) === 0)
        qmt(this.afterUpdateNextTick);
    }
    updateNextTick() {
      if ((this.stream._duplexState & READ_NEXT_TICK) !== 0)
        return;
      this.stream._duplexState |= READ_NEXT_TICK;
      if ((this.stream._duplexState & READ_UPDATING) === 0)
        qmt(this.afterUpdateNextTick);
    }
  }

  class TransformState {
    constructor(stream) {
      this.data = null;
      this.afterTransform = afterTransform.bind(stream);
      this.afterFinal = null;
    }
  }

  class Pipeline {
    constructor(src, dst, cb) {
      this.from = src;
      this.to = dst;
      this.afterPipe = cb;
      this.error = null;
      this.pipeToFinished = false;
    }
    finished() {
      this.pipeToFinished = true;
    }
    done(stream, err2) {
      if (err2)
        this.error = err2;
      if (stream === this.to) {
        this.to = null;
        if (this.from !== null) {
          if ((this.from._duplexState & READ_DONE) === 0 || !this.pipeToFinished) {
            this.from.destroy(this.error || StreamError.PREMATURE_CLOSE("Writable stream closed"));
          }
          return;
        }
      }
      if (stream === this.from) {
        this.from = null;
        if (this.to !== null) {
          if ((stream._duplexState & READ_DONE) === 0) {
            this.to.destroy(this.error || StreamError.PREMATURE_CLOSE("Readable stream closed"));
          }
          return;
        }
      }
      if (this.afterPipe !== null)
        this.afterPipe(this.error);
      this.to = this.from = this.afterPipe = null;
    }
  }
  function afterDrain() {
    this.stream._duplexState |= READ_PIPE_DRAINED;
    this.updateCallback();
  }
  function afterFinal(err2) {
    const stream = this.stream;
    if (err2)
      stream.destroy(err2);
    if ((stream._duplexState & DESTROY_STATUS) === 0) {
      stream._duplexState |= WRITE_DONE;
      stream.emit("finish");
    }
    if ((stream._duplexState & AUTO_DESTROY) === DONE) {
      stream._duplexState |= DESTROYING;
    }
    stream._duplexState &= WRITE_NOT_FINISHING;
    if ((stream._duplexState & WRITE_UPDATING) === 0) {
      this.update();
    } else {
      this.updateNextTick();
    }
  }
  function afterDestroy(err2) {
    const stream = this.stream;
    if (!err2 && !StreamError.isStreamDestroyed(this.error))
      err2 = this.error;
    if (err2)
      stream.emit("error", err2);
    stream._duplexState |= DESTROYED;
    stream.emit("close");
    const rs = stream._readableState;
    const ws = stream._writableState;
    if (rs !== null && rs.pipeline !== null) {
      rs.pipeline.done(stream, err2);
    }
    if (ws !== null) {
      while (ws.drains !== null && ws.drains.length > 0) {
        ws.drains.shift().resolve(false);
      }
      if (ws.pipeline !== null) {
        ws.pipeline.done(stream, err2);
      }
    }
  }
  function afterWrite(err2) {
    const stream = this.stream;
    if (err2)
      stream.destroy(err2);
    stream._duplexState &= WRITE_NOT_ACTIVE;
    if (this.drains !== null)
      tickDrains(this.drains);
    if ((stream._duplexState & WRITE_DRAIN_STATUS) === WRITE_UNDRAINED) {
      stream._duplexState &= WRITE_DRAINED;
      if ((stream._duplexState & WRITE_EMIT_DRAIN) === WRITE_EMIT_DRAIN) {
        stream.emit("drain");
      }
    }
    this.updateCallback();
  }
  function afterRead(err2) {
    if (err2)
      this.stream.destroy(err2);
    this.stream._duplexState &= READ_NOT_ACTIVE;
    if (this.readAhead === false && (this.stream._duplexState & READ_RESUMED) === 0) {
      this.stream._duplexState &= READ_NO_READ_AHEAD;
    }
    this.updateCallback();
  }
  function updateReadNT() {
    if ((this.stream._duplexState & READ_UPDATING) === 0) {
      this.stream._duplexState &= READ_NOT_NEXT_TICK;
      this.update();
    }
  }
  function updateWriteNT() {
    if ((this.stream._duplexState & WRITE_UPDATING) === 0) {
      this.stream._duplexState &= WRITE_NOT_NEXT_TICK;
      this.update();
    }
  }
  function tickDrains(drains) {
    for (let i2 = 0;i2 < drains.length; i2++) {
      if (--drains[i2].writes === 0) {
        drains.shift().resolve(true);
        i2--;
      }
    }
  }
  function afterOpen(err2) {
    const stream = this.stream;
    if (err2)
      stream.destroy(err2);
    if ((stream._duplexState & DESTROYING) === 0) {
      if ((stream._duplexState & READ_PRIMARY_STATUS) === 0) {
        stream._duplexState |= READ_PRIMARY;
      }
      if ((stream._duplexState & WRITE_PRIMARY_STATUS) === 0) {
        stream._duplexState |= WRITE_PRIMARY;
      }
      stream.emit("open");
    }
    stream._duplexState &= NOT_ACTIVE;
    if (stream._writableState !== null) {
      stream._writableState.updateCallback();
    }
    if (stream._readableState !== null) {
      stream._readableState.updateCallback();
    }
  }
  function afterTransform(err2, data) {
    if (data !== undefined && data !== null)
      this.push(data);
    this._writableState.afterWrite(err2);
  }
  function newListener(name) {
    if (this._readableState !== null) {
      if (name === "data") {
        this._duplexState |= READ_EMIT_DATA | READ_RESUMED_READ_AHEAD;
        this._readableState.updateNextTick();
      }
      if (name === "readable") {
        this._duplexState |= READ_EMIT_READABLE;
        this._readableState.updateNextTick();
      }
    }
    if (this._writableState !== null) {
      if (name === "drain") {
        this._duplexState |= WRITE_EMIT_DRAIN;
        this._writableState.updateNextTick();
      }
    }
  }

  class Stream extends EventEmitter {
    constructor(opts) {
      super();
      this._duplexState = 0;
      this._readableState = null;
      this._writableState = null;
      if (opts) {
        if (opts.open)
          this._open = opts.open;
        if (opts.destroy)
          this._destroy = opts.destroy;
        if (opts.predestroy)
          this._predestroy = opts.predestroy;
        if (opts.signal)
          opts.signal.addEventListener("abort", abort.bind(this));
      }
      this.on("newListener", newListener);
    }
    _open(cb) {
      cb(null);
    }
    _destroy(cb) {
      cb(null);
    }
    _predestroy() {}
    get readable() {
      return this._readableState !== null ? true : undefined;
    }
    get writable() {
      return this._writableState !== null ? true : undefined;
    }
    get destroyed() {
      return (this._duplexState & DESTROYED) !== 0;
    }
    get destroying() {
      return (this._duplexState & DESTROY_STATUS) !== 0;
    }
    destroy(err2) {
      if ((this._duplexState & DESTROY_STATUS) === 0) {
        if (!err2)
          err2 = StreamError.STREAM_DESTROYED();
        this._duplexState = (this._duplexState | DESTROYING) & NON_PRIMARY;
        if (this._readableState !== null) {
          this._readableState.highWaterMark = 0;
          this._readableState.error = err2;
        }
        if (this._writableState !== null) {
          this._writableState.highWaterMark = 0;
          this._writableState.error = err2;
        }
        this._duplexState |= PREDESTROYING;
        this._predestroy();
        this._duplexState &= NOT_PREDESTROYING;
        if (this._readableState !== null) {
          this._readableState.updateNextTick();
        }
        if (this._writableState !== null) {
          this._writableState.updateNextTick();
        }
      }
    }
  }

  class Readable extends Stream {
    constructor(opts) {
      super(opts);
      this._duplexState |= OPENING | WRITE_DONE | READ_READ_AHEAD;
      this._readableState = new ReadableState(this, opts);
      if (opts) {
        if (this._readableState.readAhead === false)
          this._duplexState &= READ_NO_READ_AHEAD;
        if (opts.read)
          this._read = opts.read;
        if (opts.eagerOpen)
          this._readableState.updateNextTick();
        if (opts.encoding)
          this.setEncoding(opts.encoding);
      }
    }
    static deferred(fn, opts) {
      const out = new PassThrough(opts);
      fn().then((src) => {
        if (src === null)
          return out.end();
        if (out.destroying)
          return;
        pipeline(src, out, noop);
      }).catch((err2) => out.destroy(err2));
      return out;
    }
    setEncoding(encoding) {
      const dec = new TextDecoder2(encoding);
      const map = this._readableState.map || echo;
      this._readableState.map = mapOrSkip;
      return this;
      function mapOrSkip(data) {
        const next = dec.push(data);
        return next === "" && (data.byteLength !== 0 || dec.remaining > 0) ? null : map(next);
      }
    }
    _read(cb) {
      cb(null);
    }
    pipe(dest, cb) {
      this._readableState.updateNextTick();
      this._readableState.pipe(dest, cb);
      return dest;
    }
    read() {
      this._readableState.updateNextTick();
      return this._readableState.read();
    }
    push(data) {
      this._readableState.updateNextTickIfOpen();
      return this._readableState.push(data);
    }
    unshift(data) {
      this._readableState.updateNextTickIfOpen();
      return this._readableState.unshift(data);
    }
    resume() {
      this._duplexState |= READ_RESUMED_READ_AHEAD;
      this._readableState.updateNextTick();
      return this;
    }
    pause() {
      this._duplexState &= this._readableState.readAhead === false ? READ_PAUSED_NO_READ_AHEAD : READ_PAUSED;
      return this;
    }
    static _fromAsyncIterator(ite, opts) {
      let destroy;
      const rs = new Readable({
        ...opts,
        read(cb) {
          ite.next().then(push).then(cb.bind(null, null)).catch(cb);
        },
        predestroy() {
          destroy = ite.return();
        },
        destroy(cb) {
          if (!destroy)
            return cb(null);
          destroy.then(cb.bind(null, null)).catch(cb);
        }
      });
      return rs;
      function push(data) {
        if (data.done)
          rs.push(null);
        else
          rs.push(data.value);
      }
    }
    static from(data, opts) {
      if (isReadStreamx(data))
        return data;
      if (data[asyncIterator])
        return this._fromAsyncIterator(data[asyncIterator](), opts);
      if (!Array.isArray(data))
        data = data === undefined ? [] : [data];
      let i2 = 0;
      return new Readable({
        ...opts,
        read(cb) {
          this.push(i2 === data.length ? null : data[i2++]);
          cb(null);
        }
      });
    }
    static isBackpressured(rs) {
      return (rs._duplexState & READ_BACKPRESSURE_STATUS) !== 0 || rs._readableState.buffered >= rs._readableState.highWaterMark;
    }
    static isPaused(rs) {
      return (rs._duplexState & READ_RESUMED) === 0;
    }
    [asyncIterator]() {
      const stream = this;
      let error = null;
      let promiseResolve = null;
      let promiseReject = null;
      this.on("error", (err2) => {
        error = err2;
      });
      this.on("readable", onreadable);
      this.on("close", onclose);
      return {
        [asyncIterator]() {
          return this;
        },
        next() {
          return new Promise(function(resolve, reject) {
            promiseResolve = resolve;
            promiseReject = reject;
            const data = stream.read();
            if (data !== null)
              ondata(data);
            else if ((stream._duplexState & DESTROYED) !== 0)
              ondata(null);
          });
        },
        return() {
          return destroy(null);
        },
        throw(err2) {
          return destroy(err2);
        }
      };
      function onreadable() {
        if (promiseResolve !== null)
          ondata(stream.read());
      }
      function onclose() {
        if (promiseResolve !== null)
          ondata(null);
      }
      function ondata(data) {
        if (promiseReject === null)
          return;
        if (error) {
          promiseReject(error);
        } else if (data === null && (stream._duplexState & READ_DONE) === 0) {
          promiseReject(StreamError.STREAM_DESTROYED());
        } else {
          promiseResolve({ value: data, done: data === null });
        }
        promiseReject = promiseResolve = null;
      }
      function destroy(err2) {
        stream.destroy(err2);
        return new Promise((resolve, reject) => {
          if (stream._duplexState & DESTROYED)
            return resolve({ value: undefined, done: true });
          stream.once("close", function() {
            if (err2)
              reject(err2);
            else
              resolve({ value: undefined, done: true });
          });
        });
      }
    }
  }

  class Writable extends Stream {
    constructor(opts) {
      super(opts);
      this._duplexState |= OPENING | READ_DONE;
      this._writableState = new WritableState(this, opts);
      if (opts) {
        if (opts.writev)
          this._writev = opts.writev;
        if (opts.write)
          this._write = opts.write;
        if (opts.final)
          this._final = opts.final;
        if (opts.eagerOpen)
          this._writableState.updateNextTick();
      }
    }
    cork() {
      this._duplexState |= WRITE_CORKED;
    }
    uncork() {
      this._duplexState &= WRITE_NOT_CORKED;
      this._writableState.updateNextTick();
    }
    _writev(batch, cb) {
      cb(null);
    }
    _write(data, cb) {
      this._writableState.autoBatch(data, cb);
    }
    _final(cb) {
      cb(null);
    }
    static isBackpressured(ws) {
      return (ws._duplexState & WRITE_BACKPRESSURE_STATUS) !== 0;
    }
    static drained(ws) {
      if (ws.destroyed)
        return Promise.resolve(false);
      const state = ws._writableState;
      const pending = isWritev(ws) ? Math.min(1, state.queue.length) : state.queue.length;
      const writes = pending + (ws._duplexState & WRITE_WRITING ? 1 : 0);
      if (writes === 0)
        return Promise.resolve(true);
      if (state.drains === null)
        state.drains = [];
      return new Promise((resolve) => {
        state.drains.push({ writes, resolve });
      });
    }
    write(data) {
      this._writableState.updateNextTick();
      return this._writableState.push(data);
    }
    end(data) {
      this._writableState.updateNextTick();
      this._writableState.end(data);
      return this;
    }
  }

  class Duplex extends Readable {
    constructor(opts) {
      super(opts);
      this._duplexState = OPENING | this._duplexState & READ_READ_AHEAD;
      this._writableState = new WritableState(this, opts);
      if (opts) {
        if (opts.writev)
          this._writev = opts.writev;
        if (opts.write)
          this._write = opts.write;
        if (opts.final)
          this._final = opts.final;
      }
    }
    cork() {
      this._duplexState |= WRITE_CORKED;
    }
    uncork() {
      this._duplexState &= WRITE_NOT_CORKED;
      this._writableState.updateNextTick();
    }
    _writev(batch, cb) {
      cb(null);
    }
    _write(data, cb) {
      this._writableState.autoBatch(data, cb);
    }
    _final(cb) {
      cb(null);
    }
    write(data) {
      this._writableState.updateNextTick();
      return this._writableState.push(data);
    }
    end(data) {
      this._writableState.updateNextTick();
      this._writableState.end(data);
      return this;
    }
  }

  class Transform extends Duplex {
    constructor(opts) {
      super(opts);
      this._transformState = new TransformState(this);
      if (opts) {
        if (opts.transform)
          this._transform = opts.transform;
        if (opts.flush)
          this._flush = opts.flush;
      }
    }
    _write(data, cb) {
      if (this._readableState.buffered >= this._readableState.highWaterMark) {
        this._transformState.data = data;
      } else {
        this._transform(data, this._transformState.afterTransform);
      }
    }
    _read(cb) {
      if (this._transformState.data !== null) {
        const data = this._transformState.data;
        this._transformState.data = null;
        cb(null);
        this._transform(data, this._transformState.afterTransform);
      } else {
        cb(null);
      }
    }
    destroy(err2) {
      super.destroy(err2);
      if (this._transformState.data !== null) {
        this._transformState.data = null;
        this._transformState.afterTransform();
      }
    }
    _transform(data, cb) {
      cb(null, data);
    }
    _flush(cb) {
      cb(null);
    }
    _final(cb) {
      this._transformState.afterFinal = cb;
      this._flush(transformAfterFlush.bind(this));
    }
  }

  class PassThrough extends Transform {
  }
  function transformAfterFlush(err2, data) {
    const cb = this._transformState.afterFinal;
    if (err2)
      return cb(err2);
    if (data !== null && data !== undefined)
      this.push(data);
    this.push(null);
    cb(null);
  }
  function pipelinePromise(...streams) {
    return new Promise((resolve, reject) => {
      return pipeline(...streams, (err2) => {
        if (err2)
          return reject(err2);
        resolve();
      });
    });
  }
  function pipeline(stream, ...streams) {
    const all = Array.isArray(stream) ? [...stream, ...streams] : [stream, ...streams];
    const done = all.length && typeof all[all.length - 1] === "function" ? all.pop() : null;
    if (all.length < 2)
      throw StreamError.BAD_ARGUMENT("Pipeline requires at least 2 streams");
    let src = all[0];
    let dest = null;
    let error = null;
    for (let i2 = 1;i2 < all.length; i2++) {
      dest = all[i2];
      if (isStreamx(src)) {
        src.pipe(dest, onerror);
      } else {
        errorHandle(src, true, i2 > 1, onerror);
        src.pipe(dest);
      }
      src = dest;
    }
    if (done) {
      let fin = false;
      const autoDestroy = isStreamx(dest) || !!(dest._writableState && dest._writableState.autoDestroy);
      dest.on("error", (err2) => {
        if (error === null)
          error = err2;
      });
      dest.on("finish", () => {
        fin = true;
        if (!autoDestroy)
          done(error);
      });
      if (autoDestroy) {
        dest.on("close", () => done(error || (fin ? null : StreamError.PREMATURE_CLOSE())));
      }
    }
    return dest;
    function errorHandle(s, rd, wr, onerror2) {
      s.on("error", onerror2);
      s.on("close", onclose);
      function onclose() {
        if (rd && s._readableState && !s._readableState.ended) {
          return onerror2(StreamError.PREMATURE_CLOSE());
        }
        if (wr && s._writableState && !s._writableState.ended) {
          return onerror2(StreamError.PREMATURE_CLOSE());
        }
      }
    }
    function onerror(err2) {
      if (!err2 || error)
        return;
      error = err2;
      for (const s of all) {
        s.destroy(err2);
      }
    }
  }
  function echo(s) {
    return s;
  }
  function isStream(stream) {
    return !!stream._readableState || !!stream._writableState;
  }
  function isStreamx(stream) {
    return typeof stream._duplexState === "number" && isStream(stream);
  }
  function isEnding(stream) {
    return !!stream._readableState && stream._readableState.ending;
  }
  function isEnded(stream) {
    return !!stream._readableState && stream._readableState.ended;
  }
  function isFinishing(stream) {
    return !!stream._writableState && stream._writableState.ending;
  }
  function isFinished(stream) {
    return !!stream._writableState && stream._writableState.ended;
  }
  function getStreamError(stream, opts = {}) {
    const err2 = stream._readableState && stream._readableState.error || stream._writableState && stream._writableState.error;
    return !opts.all && StreamError.isStreamDestroyed(err2) ? null : err2;
  }
  function isReadStreamx(stream) {
    return isStreamx(stream) && stream.readable;
  }
  function isDisturbed(stream) {
    return (stream._duplexState & OPENING) !== OPENING || (stream._duplexState & DESTROYING) === DESTROYING || (stream._duplexState & ACTIVE_OR_TICKING) !== 0;
  }
  function isTypedArray(data) {
    return typeof data === "object" && data !== null && typeof data.byteLength === "number";
  }
  function defaultByteLength(data) {
    return isTypedArray(data) ? data.byteLength : 1024;
  }
  function noop() {}
  function abort() {
    this.destroy(StreamError.ABORTED());
  }
  function isWritev(s) {
    return s._writev !== Writable.prototype._writev && s._writev !== Duplex.prototype._writev;
  }
  module.exports = {
    pipeline,
    pipelinePromise,
    isStream,
    isStreamx,
    isEnding,
    isEnded,
    isFinishing,
    isFinished,
    isDisturbed,
    getStreamError,
    Stream,
    Writable,
    Readable,
    Duplex,
    Transform,
    PassThrough
  };
});

// node_modules/tar-stream/headers.js
var require_headers = __commonJS((exports) => {
  var b4a = require_b4a();
  var ZEROS = "0000000000000000000";
  var SEVENS = "7777777777777777777";
  var ZERO_OFFSET = 48;
  var USTAR_MAGIC = b4a.from([117, 115, 116, 97, 114, 0]);
  var USTAR_VER = b4a.from([ZERO_OFFSET, ZERO_OFFSET]);
  var GNU_MAGIC = b4a.from([117, 115, 116, 97, 114, 32]);
  var GNU_VER = b4a.from([32, 0]);
  var MASK = 4095;
  var MAGIC_OFFSET = 257;
  var VERSION_OFFSET = 263;
  exports.decodeLongPath = function decodeLongPath(buf, encoding) {
    return decodeStr(buf, 0, buf.length, encoding);
  };
  exports.encodePax = function encodePax(opts) {
    let result = "";
    if (opts.name)
      result += addLength(" path=" + opts.name + `
`);
    if (opts.linkname)
      result += addLength(" linkpath=" + opts.linkname + `
`);
    const pax = opts.pax;
    if (pax) {
      for (const key in pax) {
        result += addLength(" " + key + "=" + pax[key] + `
`);
      }
    }
    return b4a.from(result);
  };
  exports.decodePax = function decodePax(buf) {
    const result = {};
    while (buf.length) {
      let i2 = 0;
      while (i2 < buf.length && buf[i2] !== 32)
        i2++;
      const len = parseInt(b4a.toString(buf.subarray(0, i2)), 10);
      if (!len)
        return result;
      const b = b4a.toString(buf.subarray(i2 + 1, len - 1));
      const keyIndex = b.indexOf("=");
      if (keyIndex === -1)
        return result;
      result[b.slice(0, keyIndex)] = b.slice(keyIndex + 1);
      buf = buf.subarray(len);
    }
    return result;
  };
  exports.encode = function encode(opts) {
    const buf = b4a.alloc(512);
    let name = opts.name;
    let prefix = "";
    if (opts.typeflag === 5 && name[name.length - 1] !== "/")
      name += "/";
    if (b4a.byteLength(name) !== name.length)
      return null;
    while (b4a.byteLength(name) > 100) {
      const i2 = name.indexOf("/");
      if (i2 === -1)
        return null;
      prefix += prefix ? "/" + name.slice(0, i2) : name.slice(0, i2);
      name = name.slice(i2 + 1);
    }
    if (b4a.byteLength(name) > 100 || b4a.byteLength(prefix) > 155)
      return null;
    if (opts.linkname && b4a.byteLength(opts.linkname) > 100)
      return null;
    b4a.write(buf, name);
    b4a.write(buf, encodeOct(opts.mode & MASK, 6), 100);
    b4a.write(buf, encodeOct(opts.uid, 6), 108);
    b4a.write(buf, encodeOct(opts.gid, 6), 116);
    encodeSize(opts.size, buf, 124);
    b4a.write(buf, encodeOct(opts.mtime.getTime() / 1000 | 0, 11), 136);
    buf[156] = ZERO_OFFSET + toTypeflag(opts.type);
    if (opts.linkname)
      b4a.write(buf, opts.linkname, 157);
    b4a.copy(USTAR_MAGIC, buf, MAGIC_OFFSET);
    b4a.copy(USTAR_VER, buf, VERSION_OFFSET);
    if (opts.uname)
      b4a.write(buf, opts.uname, 265);
    if (opts.gname)
      b4a.write(buf, opts.gname, 297);
    b4a.write(buf, encodeOct(opts.devmajor || 0, 6), 329);
    b4a.write(buf, encodeOct(opts.devminor || 0, 6), 337);
    if (prefix)
      b4a.write(buf, prefix, 345);
    b4a.write(buf, encodeOct(cksum(buf), 6), 148);
    return buf;
  };
  exports.decode = function decode(buf, filenameEncoding, allowUnknownFormat) {
    let typeflag = buf[156] === 0 ? 0 : buf[156] - ZERO_OFFSET;
    let name = decodeStr(buf, 0, 100, filenameEncoding);
    const mode = decodeOct(buf, 100, 8);
    const uid = decodeOct(buf, 108, 8);
    const gid = decodeOct(buf, 116, 8);
    const size = decodeOct(buf, 124, 12);
    const mtime = decodeOct(buf, 136, 12);
    const type = toType(typeflag);
    const linkname = buf[157] === 0 ? null : decodeStr(buf, 157, 100, filenameEncoding);
    const uname = decodeStr(buf, 265, 32);
    const gname = decodeStr(buf, 297, 32);
    const devmajor = decodeOct(buf, 329, 8);
    const devminor = decodeOct(buf, 337, 8);
    const c = cksum(buf);
    if (c === 8 * 32)
      return null;
    if (c !== decodeOct(buf, 148, 8))
      throw new Error("Invalid tar header. Maybe the tar is corrupted or it needs to be gunzipped?");
    if (isUSTAR(buf)) {
      if (buf[345])
        name = decodeStr(buf, 345, 155, filenameEncoding) + "/" + name;
    } else if (isGNU(buf)) {} else {
      if (!allowUnknownFormat) {
        throw new Error("Invalid tar header: unknown format.");
      }
    }
    if (typeflag === 0 && name && name[name.length - 1] === "/")
      typeflag = 5;
    return {
      name,
      mode,
      uid,
      gid,
      size,
      mtime: new Date(1000 * mtime),
      type,
      linkname,
      uname,
      gname,
      devmajor,
      devminor,
      pax: null
    };
  };
  function isUSTAR(buf) {
    return b4a.equals(USTAR_MAGIC, buf.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 6));
  }
  function isGNU(buf) {
    return b4a.equals(GNU_MAGIC, buf.subarray(MAGIC_OFFSET, MAGIC_OFFSET + 6)) && b4a.equals(GNU_VER, buf.subarray(VERSION_OFFSET, VERSION_OFFSET + 2));
  }
  function clamp(index, len, defaultValue) {
    if (typeof index !== "number")
      return defaultValue;
    index = ~~index;
    if (index >= len)
      return len;
    if (index >= 0)
      return index;
    index += len;
    if (index >= 0)
      return index;
    return 0;
  }
  function toType(flag) {
    switch (flag) {
      case 0:
        return "file";
      case 1:
        return "link";
      case 2:
        return "symlink";
      case 3:
        return "character-device";
      case 4:
        return "block-device";
      case 5:
        return "directory";
      case 6:
        return "fifo";
      case 7:
        return "contiguous-file";
      case 72:
        return "pax-header";
      case 55:
        return "pax-global-header";
      case 27:
        return "gnu-long-link-path";
      case 28:
      case 30:
        return "gnu-long-path";
    }
    return null;
  }
  function toTypeflag(flag) {
    switch (flag) {
      case "file":
        return 0;
      case "link":
        return 1;
      case "symlink":
        return 2;
      case "character-device":
        return 3;
      case "block-device":
        return 4;
      case "directory":
        return 5;
      case "fifo":
        return 6;
      case "contiguous-file":
        return 7;
      case "pax-header":
        return 72;
    }
    return 0;
  }
  function indexOf(block, num, offset, end) {
    for (;offset < end; offset++) {
      if (block[offset] === num)
        return offset;
    }
    return end;
  }
  function cksum(block) {
    let sum = 8 * 32;
    for (let i2 = 0;i2 < 148; i2++)
      sum += block[i2];
    for (let j = 156;j < 512; j++)
      sum += block[j];
    return sum;
  }
  function encodeOct(val, n) {
    val = val.toString(8);
    if (val.length > n)
      return SEVENS.slice(0, n) + " ";
    return ZEROS.slice(0, n - val.length) + val + " ";
  }
  function encodeSizeBin(num, buf, off) {
    buf[off] = 128;
    for (let i2 = 11;i2 > 0; i2--) {
      buf[off + i2] = num & 255;
      num = Math.floor(num / 256);
    }
  }
  function encodeSize(num, buf, off) {
    if (num.toString(8).length > 11) {
      encodeSizeBin(num, buf, off);
    } else {
      b4a.write(buf, encodeOct(num, 11), off);
    }
  }
  function parse256(buf) {
    let positive;
    if (buf[0] === 128)
      positive = true;
    else if (buf[0] === 255)
      positive = false;
    else
      return null;
    const tuple = [];
    let i2;
    for (i2 = buf.length - 1;i2 > 0; i2--) {
      const byte = buf[i2];
      if (positive)
        tuple.push(byte);
      else
        tuple.push(255 - byte);
    }
    let sum = 0;
    const l = tuple.length;
    for (i2 = 0;i2 < l; i2++) {
      sum += tuple[i2] * Math.pow(256, i2);
    }
    return positive ? sum : -1 * sum;
  }
  function decodeOct(val, offset, length) {
    val = val.subarray(offset, offset + length);
    offset = 0;
    if (val[offset] & 128) {
      return parse256(val);
    } else {
      while (offset < val.length && val[offset] === 32)
        offset++;
      const end = clamp(indexOf(val, 32, offset, val.length), val.length, val.length);
      while (offset < end && val[offset] === 0)
        offset++;
      if (end === offset)
        return 0;
      return parseInt(b4a.toString(val.subarray(offset, end)), 8);
    }
  }
  function decodeStr(val, offset, length, encoding) {
    return b4a.toString(val.subarray(offset, indexOf(val, 0, offset, offset + length)), encoding);
  }
  function addLength(str) {
    const len = b4a.byteLength(str);
    let digits = Math.floor(Math.log(len) / Math.log(10)) + 1;
    if (len + digits >= Math.pow(10, digits))
      digits++;
    return len + digits + str;
  }
});

// node_modules/tar-stream/extract.js
var require_extract = __commonJS((exports, module) => {
  var { Writable, Readable, getStreamError } = require_streamx();
  var FIFO = require_fast_fifo();
  var b4a = require_b4a();
  var headers = require_headers();
  var EMPTY = b4a.alloc(0);

  class BufferList {
    constructor() {
      this.buffered = 0;
      this.shifted = 0;
      this.queue = new FIFO;
      this._offset = 0;
    }
    push(buffer) {
      this.buffered += buffer.byteLength;
      this.queue.push(buffer);
    }
    shiftFirst(size) {
      return this._buffered === 0 ? null : this._next(size);
    }
    shift(size) {
      if (size > this.buffered)
        return null;
      if (size === 0)
        return EMPTY;
      let chunk = this._next(size);
      if (size === chunk.byteLength)
        return chunk;
      const chunks = [chunk];
      while ((size -= chunk.byteLength) > 0) {
        chunk = this._next(size);
        chunks.push(chunk);
      }
      return b4a.concat(chunks);
    }
    _next(size) {
      const buf = this.queue.peek();
      const rem = buf.byteLength - this._offset;
      if (size >= rem) {
        const sub = this._offset ? buf.subarray(this._offset, buf.byteLength) : buf;
        this.queue.shift();
        this._offset = 0;
        this.buffered -= rem;
        this.shifted += rem;
        return sub;
      }
      this.buffered -= size;
      this.shifted += size;
      return buf.subarray(this._offset, this._offset += size);
    }
  }

  class Source extends Readable {
    constructor(self, header, offset) {
      super();
      this.header = header;
      this.offset = offset;
      this._parent = self;
    }
    _read(cb) {
      if (this.header.size === 0) {
        this.push(null);
      }
      if (this._parent._stream === this) {
        this._parent._update();
      }
      cb(null);
    }
    _predestroy() {
      this._parent.destroy(getStreamError(this));
    }
    _detach() {
      if (this._parent._stream === this) {
        this._parent._stream = null;
        this._parent._missing = overflow(this.header.size);
        this._parent._update();
      }
    }
    _destroy(cb) {
      this._detach();
      cb(null);
    }
  }

  class Extract extends Writable {
    constructor(opts) {
      super(opts);
      if (!opts)
        opts = {};
      this._buffer = new BufferList;
      this._offset = 0;
      this._header = null;
      this._stream = null;
      this._missing = 0;
      this._longHeader = false;
      this._callback = noop;
      this._locked = false;
      this._finished = false;
      this._pax = null;
      this._paxGlobal = null;
      this._gnuLongPath = null;
      this._gnuLongLinkPath = null;
      this._filenameEncoding = opts.filenameEncoding || "utf-8";
      this._allowUnknownFormat = !!opts.allowUnknownFormat;
      this._unlockBound = this._unlock.bind(this);
    }
    _unlock(err2) {
      this._locked = false;
      if (err2) {
        this.destroy(err2);
        this._continueWrite(err2);
        return;
      }
      this._update();
    }
    _consumeHeader() {
      if (this._locked)
        return false;
      this._offset = this._buffer.shifted;
      try {
        this._header = headers.decode(this._buffer.shift(512), this._filenameEncoding, this._allowUnknownFormat);
      } catch (err2) {
        this._continueWrite(err2);
        return false;
      }
      if (!this._header)
        return true;
      switch (this._header.type) {
        case "gnu-long-path":
        case "gnu-long-link-path":
        case "pax-global-header":
        case "pax-header":
          this._longHeader = true;
          this._missing = this._header.size;
          return true;
      }
      this._locked = true;
      this._applyLongHeaders();
      if (this._header.size === 0 || this._header.type === "directory") {
        this.emit("entry", this._header, this._createStream(), this._unlockBound);
        return true;
      }
      this._stream = this._createStream();
      this._missing = this._header.size;
      this.emit("entry", this._header, this._stream, this._unlockBound);
      return true;
    }
    _applyLongHeaders() {
      if (this._gnuLongPath) {
        this._header.name = this._gnuLongPath;
        this._gnuLongPath = null;
      }
      if (this._gnuLongLinkPath) {
        this._header.linkname = this._gnuLongLinkPath;
        this._gnuLongLinkPath = null;
      }
      if (this._pax) {
        if (this._pax.path)
          this._header.name = this._pax.path;
        if (this._pax.linkpath)
          this._header.linkname = this._pax.linkpath;
        if (this._pax.size)
          this._header.size = parseInt(this._pax.size, 10);
        this._header.pax = this._pax;
        this._pax = null;
      }
    }
    _decodeLongHeader(buf) {
      switch (this._header.type) {
        case "gnu-long-path":
          this._gnuLongPath = headers.decodeLongPath(buf, this._filenameEncoding);
          break;
        case "gnu-long-link-path":
          this._gnuLongLinkPath = headers.decodeLongPath(buf, this._filenameEncoding);
          break;
        case "pax-global-header":
          this._paxGlobal = headers.decodePax(buf);
          break;
        case "pax-header":
          this._pax = this._paxGlobal === null ? headers.decodePax(buf) : Object.assign({}, this._paxGlobal, headers.decodePax(buf));
          break;
      }
    }
    _consumeLongHeader() {
      this._longHeader = false;
      this._missing = overflow(this._header.size);
      const buf = this._buffer.shift(this._header.size);
      try {
        this._decodeLongHeader(buf);
      } catch (err2) {
        this._continueWrite(err2);
        return false;
      }
      return true;
    }
    _consumeStream() {
      const buf = this._buffer.shiftFirst(this._missing);
      if (buf === null)
        return false;
      this._missing -= buf.byteLength;
      const drained = this._stream.push(buf);
      if (this._missing === 0) {
        this._stream.push(null);
        if (drained)
          this._stream._detach();
        return drained && this._locked === false;
      }
      return drained;
    }
    _createStream() {
      return new Source(this, this._header, this._offset);
    }
    _update() {
      while (this._buffer.buffered > 0 && !this.destroying) {
        if (this._missing > 0) {
          if (this._stream !== null) {
            if (this._consumeStream() === false)
              return;
            continue;
          }
          if (this._longHeader === true) {
            if (this._missing > this._buffer.buffered)
              break;
            if (this._consumeLongHeader() === false)
              return false;
            continue;
          }
          const ignore = this._buffer.shiftFirst(this._missing);
          if (ignore !== null)
            this._missing -= ignore.byteLength;
          continue;
        }
        if (this._buffer.buffered < 512)
          break;
        if (this._stream !== null || this._consumeHeader() === false)
          return;
      }
      this._continueWrite(null);
    }
    _continueWrite(err2) {
      const cb = this._callback;
      this._callback = noop;
      cb(err2);
    }
    _write(data, cb) {
      this._callback = cb;
      this._buffer.push(data);
      this._update();
    }
    _final(cb) {
      this._finished = this._missing === 0 && this._buffer.buffered === 0;
      cb(this._finished ? null : new Error("Unexpected end of data"));
    }
    _predestroy() {
      this._continueWrite(null);
    }
    _destroy(cb) {
      if (this._stream)
        this._stream.destroy(getStreamError(this));
      cb(null);
    }
    [Symbol.asyncIterator]() {
      let error = null;
      let promiseResolve = null;
      let promiseReject = null;
      let entryStream = null;
      let entryCallback = null;
      const extract = this;
      this.on("entry", onentry);
      this.on("error", (err2) => {
        error = err2;
      });
      this.on("close", onclose);
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          return new Promise(onnext);
        },
        return() {
          return destroy(null);
        },
        throw(err2) {
          return destroy(err2);
        }
      };
      function consumeCallback(err2) {
        if (!entryCallback)
          return;
        const cb = entryCallback;
        entryCallback = null;
        cb(err2);
      }
      function onnext(resolve, reject) {
        if (error) {
          return reject(error);
        }
        if (entryStream) {
          resolve({ value: entryStream, done: false });
          entryStream = null;
          return;
        }
        promiseResolve = resolve;
        promiseReject = reject;
        consumeCallback(null);
        if (extract._finished && promiseResolve) {
          promiseResolve({ value: undefined, done: true });
          promiseResolve = promiseReject = null;
        }
      }
      function onentry(header, stream, callback) {
        entryCallback = callback;
        stream.on("error", noop);
        if (promiseResolve) {
          promiseResolve({ value: stream, done: false });
          promiseResolve = promiseReject = null;
        } else {
          entryStream = stream;
        }
      }
      function onclose() {
        consumeCallback(error);
        if (!promiseResolve)
          return;
        if (error)
          promiseReject(error);
        else
          promiseResolve({ value: undefined, done: true });
        promiseResolve = promiseReject = null;
      }
      function destroy(err2) {
        extract.destroy(err2);
        consumeCallback(err2);
        return new Promise((resolve, reject) => {
          if (extract.destroyed)
            return resolve({ value: undefined, done: true });
          extract.once("close", function() {
            if (err2)
              reject(err2);
            else
              resolve({ value: undefined, done: true });
          });
        });
      }
    }
  }
  module.exports = function extract(opts) {
    return new Extract(opts);
  };
  function noop() {}
  function overflow(size) {
    size &= 511;
    return size && 512 - size;
  }
});

// node_modules/tar-stream/constants.js
var require_constants = __commonJS((exports, module) => {
  var constants = {
    S_IFMT: 61440,
    S_IFDIR: 16384,
    S_IFCHR: 8192,
    S_IFBLK: 24576,
    S_IFIFO: 4096,
    S_IFLNK: 40960
  };
  try {
    module.exports = __require("fs").constants || constants;
  } catch {
    module.exports = constants;
  }
});

// node_modules/tar-stream/pack.js
var require_pack = __commonJS((exports, module) => {
  var { Readable, Writable, getStreamError } = require_streamx();
  var b4a = require_b4a();
  var constants = require_constants();
  var headers = require_headers();
  var DMODE = 493;
  var FMODE = 420;
  var END_OF_TAR = b4a.alloc(1024);

  class Sink extends Writable {
    constructor(pack, header, callback) {
      super({ mapWritable, eagerOpen: true });
      this.written = 0;
      this.header = header;
      this._callback = callback;
      this._linkname = null;
      this._isLinkname = header.type === "symlink" && !header.linkname;
      this._isVoid = header.type !== "file" && header.type !== "contiguous-file";
      this._finished = false;
      this._pack = pack;
      this._openCallback = null;
      if (this._pack._stream === null)
        this._pack._stream = this;
      else
        this._pack._pending.push(this);
    }
    _open(cb) {
      this._openCallback = cb;
      if (this._pack._stream === this)
        this._continueOpen();
    }
    _continuePack(err2) {
      if (this._callback === null)
        return;
      const callback = this._callback;
      this._callback = null;
      callback(err2);
    }
    _continueOpen() {
      if (this._pack._stream === null)
        this._pack._stream = this;
      const cb = this._openCallback;
      this._openCallback = null;
      if (cb === null)
        return;
      if (this._pack.destroying)
        return cb(new Error("pack stream destroyed"));
      if (this._pack._finalized)
        return cb(new Error("pack stream is already finalized"));
      this._pack._stream = this;
      if (!this._isLinkname) {
        this._pack._encode(this.header);
      }
      if (this._isVoid) {
        this._finish();
        this._continuePack(null);
      }
      cb(null);
    }
    _write(data, cb) {
      if (this._isLinkname) {
        this._linkname = this._linkname ? b4a.concat([this._linkname, data]) : data;
        return cb(null);
      }
      if (this._isVoid) {
        if (data.byteLength > 0) {
          return cb(new Error("No body allowed for this entry"));
        }
        return cb();
      }
      this.written += data.byteLength;
      if (this._pack.push(data))
        return cb();
      this._pack._drain = cb;
    }
    _finish() {
      if (this._finished)
        return;
      this._finished = true;
      if (this._isLinkname) {
        this.header.linkname = this._linkname ? b4a.toString(this._linkname, "utf-8") : "";
        this._pack._encode(this.header);
      }
      overflow(this._pack, this.header.size);
      this._pack._done(this);
    }
    _final(cb) {
      if (this.written !== this.header.size) {
        return cb(new Error("Size mismatch"));
      }
      this._finish();
      cb(null);
    }
    _getError() {
      return getStreamError(this) || new Error("tar entry destroyed");
    }
    _predestroy() {
      this._pack.destroy(this._getError());
    }
    _destroy(cb) {
      this._pack._done(this);
      this._continuePack(this._finished ? null : this._getError());
      cb();
    }
  }

  class Pack extends Readable {
    constructor(opts) {
      super(opts);
      this._drain = noop;
      this._finalized = false;
      this._finalizing = false;
      this._pending = [];
      this._stream = null;
    }
    entry(header, buffer, callback) {
      if (this._finalized || this.destroying)
        throw new Error("already finalized or destroyed");
      if (typeof buffer === "function") {
        callback = buffer;
        buffer = null;
      }
      if (!callback)
        callback = noop;
      if (!header.size || header.type === "symlink")
        header.size = 0;
      if (!header.type)
        header.type = modeToType(header.mode);
      if (!header.mode)
        header.mode = header.type === "directory" ? DMODE : FMODE;
      if (!header.uid)
        header.uid = 0;
      if (!header.gid)
        header.gid = 0;
      if (!header.mtime)
        header.mtime = new Date;
      if (typeof buffer === "string")
        buffer = b4a.from(buffer);
      const sink = new Sink(this, header, callback);
      if (b4a.isBuffer(buffer)) {
        header.size = buffer.byteLength;
        sink.write(buffer);
        sink.end();
        return sink;
      }
      if (sink._isVoid) {
        return sink;
      }
      return sink;
    }
    finalize() {
      if (this._stream || this._pending.length > 0) {
        this._finalizing = true;
        return;
      }
      if (this._finalized)
        return;
      this._finalized = true;
      this.push(END_OF_TAR);
      this.push(null);
    }
    _done(stream) {
      if (stream !== this._stream)
        return;
      this._stream = null;
      if (this._finalizing)
        this.finalize();
      if (this._pending.length)
        this._pending.shift()._continueOpen();
    }
    _encode(header) {
      if (!header.pax) {
        const buf = headers.encode(header);
        if (buf) {
          this.push(buf);
          return;
        }
      }
      this._encodePax(header);
    }
    _encodePax(header) {
      const paxHeader = headers.encodePax({
        name: header.name,
        linkname: header.linkname,
        pax: header.pax
      });
      const newHeader = {
        name: "PaxHeader",
        mode: header.mode,
        uid: header.uid,
        gid: header.gid,
        size: paxHeader.byteLength,
        mtime: header.mtime,
        type: "pax-header",
        linkname: header.linkname && "PaxHeader",
        uname: header.uname,
        gname: header.gname,
        devmajor: header.devmajor,
        devminor: header.devminor
      };
      this.push(headers.encode(newHeader));
      this.push(paxHeader);
      overflow(this, paxHeader.byteLength);
      newHeader.size = header.size;
      newHeader.type = header.type;
      this.push(headers.encode(newHeader));
    }
    _doDrain() {
      const drain = this._drain;
      this._drain = noop;
      drain();
    }
    _predestroy() {
      const err2 = getStreamError(this);
      if (this._stream)
        this._stream.destroy(err2);
      while (this._pending.length) {
        const stream = this._pending.shift();
        stream.destroy(err2);
        stream._continueOpen();
      }
      this._doDrain();
    }
    _read(cb) {
      this._doDrain();
      cb();
    }
  }
  module.exports = function pack(opts) {
    return new Pack(opts);
  };
  function modeToType(mode) {
    switch (mode & constants.S_IFMT) {
      case constants.S_IFBLK:
        return "block-device";
      case constants.S_IFCHR:
        return "character-device";
      case constants.S_IFDIR:
        return "directory";
      case constants.S_IFIFO:
        return "fifo";
      case constants.S_IFLNK:
        return "symlink";
    }
    return "file";
  }
  function noop() {}
  function overflow(self, size) {
    size &= 511;
    if (size)
      self.push(END_OF_TAR.subarray(0, 512 - size));
  }
  function mapWritable(buf) {
    return b4a.isBuffer(buf) ? buf : b4a.from(buf);
  }
});

// runtime/vnext/src/install-tools-cli.ts
import * as path3 from "node:path";

// runtime/vnext/src/install-tools.ts
import * as fs2 from "node:fs";
import * as path2 from "node:path";
import { createHash as createHash2 } from "node:crypto";
import { execFileSync as execFileSync2 } from "node:child_process";
import { gunzipSync } from "node:zlib";

// node_modules/fflate/esm/index.mjs
import { createRequire as createRequire2 } from "module";
var require2 = createRequire2("/");
var Worker;
try {
  Worker = require2("worker_threads").Worker;
} catch (e) {}
var u8 = Uint8Array;
var u16 = Uint16Array;
var i32 = Int32Array;
var fleb = new u8([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0, 0, 0, 0]);
var fdeb = new u8([0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 0, 0]);
var clim = new u8([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
var freb = function(eb, start) {
  var b = new u16(31);
  for (var i = 0;i < 31; ++i) {
    b[i] = start += 1 << eb[i - 1];
  }
  var r = new i32(b[30]);
  for (var i = 1;i < 30; ++i) {
    for (var j = b[i];j < b[i + 1]; ++j) {
      r[j] = j - b[i] << 5 | i;
    }
  }
  return { b, r };
};
var _a = freb(fleb, 2);
var fl = _a.b;
var revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0);
var fd = _b.b;
var revfd = _b.r;
var rev = new u16(32768);
for (i = 0;i < 32768; ++i) {
  x = (i & 43690) >> 1 | (i & 21845) << 1;
  x = (x & 52428) >> 2 | (x & 13107) << 2;
  x = (x & 61680) >> 4 | (x & 3855) << 4;
  rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var x;
var i;
var hMap = function(cd, mb, r) {
  var s = cd.length;
  var i2 = 0;
  var l = new u16(mb);
  for (;i2 < s; ++i2) {
    if (cd[i2])
      ++l[cd[i2] - 1];
  }
  var le = new u16(mb);
  for (i2 = 1;i2 < mb; ++i2) {
    le[i2] = le[i2 - 1] + l[i2 - 1] << 1;
  }
  var co;
  if (r) {
    co = new u16(1 << mb);
    var rvb = 15 - mb;
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        var sv = i2 << 4 | cd[i2];
        var r_1 = mb - cd[i2];
        var v = le[cd[i2] - 1]++ << r_1;
        for (var m = v | (1 << r_1) - 1;v <= m; ++v) {
          co[rev[v] >> rvb] = sv;
        }
      }
    }
  } else {
    co = new u16(s);
    for (i2 = 0;i2 < s; ++i2) {
      if (cd[i2]) {
        co[i2] = rev[le[cd[i2] - 1]++] >> 15 - cd[i2];
      }
    }
  }
  return co;
};
var flt = new u8(288);
for (i = 0;i < 144; ++i)
  flt[i] = 8;
var i;
for (i = 144;i < 256; ++i)
  flt[i] = 9;
var i;
for (i = 256;i < 280; ++i)
  flt[i] = 7;
var i;
for (i = 280;i < 288; ++i)
  flt[i] = 8;
var i;
var fdt = new u8(32);
for (i = 0;i < 32; ++i)
  fdt[i] = 5;
var i;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1);
var fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
  var m = a[0];
  for (var i2 = 1;i2 < a.length; ++i2) {
    if (a[i2] > m)
      m = a[i2];
  }
  return m;
};
var bits = function(d, p, m) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
  var o = p / 8 | 0;
  return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
  return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
  if (s == null || s < 0)
    s = 0;
  if (e == null || e > v.length)
    e = v.length;
  return new u8(v.subarray(s, e));
};
var ec = [
  "unexpected EOF",
  "invalid block type",
  "invalid length/literal",
  "invalid distance",
  "stream finished",
  "no stream handler",
  ,
  "no callback",
  "invalid UTF-8 data",
  "extra field too long",
  "date not in range 1980-2099",
  "filename too long",
  "stream finishing",
  "invalid zip data"
];
var err = function(ind, msg, nt) {
  var e = new Error(msg || ec[ind]);
  e.code = ind;
  if (Error.captureStackTrace)
    Error.captureStackTrace(e, err);
  if (!nt)
    throw e;
  return e;
};
var inflt = function(dat, st, buf, dict) {
  var sl = dat.length, dl = dict ? dict.length : 0;
  if (!sl || st.f && !st.l)
    return buf || new u8(0);
  var noBuf = !buf;
  var resize = noBuf || st.i != 2;
  var noSt = st.i;
  if (noBuf)
    buf = new u8(sl * 3);
  var cbuf = function(l2) {
    var bl = buf.length;
    if (l2 > bl) {
      var nbuf = new u8(Math.max(bl * 2, l2));
      nbuf.set(buf);
      buf = nbuf;
    }
  };
  var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
  var tbts = sl * 8;
  do {
    if (!lm) {
      final = bits(dat, pos, 1);
      var type = bits(dat, pos + 1, 3);
      pos += 3;
      if (!type) {
        var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
        if (t > sl) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + l);
        buf.set(dat.subarray(s, t), bt);
        st.b = bt += l, st.p = pos = t * 8, st.f = final;
        continue;
      } else if (type == 1)
        lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
      else if (type == 2) {
        var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
        var tl = hLit + bits(dat, pos + 5, 31) + 1;
        pos += 14;
        var ldt = new u8(tl);
        var clt = new u8(19);
        for (var i2 = 0;i2 < hcLen; ++i2) {
          clt[clim[i2]] = bits(dat, pos + i2 * 3, 7);
        }
        pos += hcLen * 3;
        var clb = max(clt), clbmsk = (1 << clb) - 1;
        var clm = hMap(clt, clb, 1);
        for (var i2 = 0;i2 < tl; ) {
          var r = clm[bits(dat, pos, clbmsk)];
          pos += r & 15;
          var s = r >> 4;
          if (s < 16) {
            ldt[i2++] = s;
          } else {
            var c = 0, n = 0;
            if (s == 16)
              n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i2 - 1];
            else if (s == 17)
              n = 3 + bits(dat, pos, 7), pos += 3;
            else if (s == 18)
              n = 11 + bits(dat, pos, 127), pos += 7;
            while (n--)
              ldt[i2++] = c;
          }
        }
        var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
        lbt = max(lt);
        dbt = max(dt);
        lm = hMap(lt, lbt, 1);
        dm = hMap(dt, dbt, 1);
      } else
        err(1);
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
    }
    if (resize)
      cbuf(bt + 131072);
    var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
    var lpos = pos;
    for (;; lpos = pos) {
      var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
      pos += c & 15;
      if (pos > tbts) {
        if (noSt)
          err(0);
        break;
      }
      if (!c)
        err(2);
      if (sym < 256)
        buf[bt++] = sym;
      else if (sym == 256) {
        lpos = pos, lm = null;
        break;
      } else {
        var add = sym - 254;
        if (sym > 264) {
          var i2 = sym - 257, b = fleb[i2];
          add = bits(dat, pos, (1 << b) - 1) + fl[i2];
          pos += b;
        }
        var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
        if (!d)
          err(3);
        pos += d & 15;
        var dt = fd[dsym];
        if (dsym > 3) {
          var b = fdeb[dsym];
          dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
        }
        if (pos > tbts) {
          if (noSt)
            err(0);
          break;
        }
        if (resize)
          cbuf(bt + 131072);
        var end = bt + add;
        if (bt < dt) {
          var shift = dl - dt, dend = Math.min(dt, end);
          if (shift + bt < 0)
            err(3);
          for (;bt < dend; ++bt)
            buf[bt] = dict[shift + bt];
        }
        for (;bt < end; ++bt)
          buf[bt] = buf[bt - dt];
      }
    }
    st.l = lm, st.p = lpos, st.b = bt, st.f = final;
    if (lm)
      final = 1, st.m = lbt, st.d = dm, st.n = dbt;
  } while (!final);
  return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d, b) {
  return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
  return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
  return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
  return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder;
var tds = 0;
try {
  td.decode(et, { stream: true });
  tds = 1;
} catch (e) {}
var dutf8 = function(d) {
  for (var r = "", i2 = 0;; ) {
    var c = d[i2++];
    var eb = (c > 127) + (c > 223) + (c > 239);
    if (i2 + eb > d.length)
      return { s: r, r: slc(d, i2 - 1) };
    if (!eb)
      r += String.fromCharCode(c);
    else if (eb == 3) {
      c = ((c & 15) << 18 | (d[i2++] & 63) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
    } else if (eb & 1)
      r += String.fromCharCode((c & 31) << 6 | d[i2++] & 63);
    else
      r += String.fromCharCode((c & 15) << 12 | (d[i2++] & 63) << 6 | d[i2++] & 63);
  }
};
function strFromU8(dat, latin1) {
  if (latin1) {
    var r = "";
    for (var i2 = 0;i2 < dat.length; i2 += 16384)
      r += String.fromCharCode.apply(null, dat.subarray(i2, i2 + 16384));
    return r;
  } else if (td) {
    return td.decode(dat);
  } else {
    var _a2 = dutf8(dat), s = _a2.s, r = _a2.r;
    if (r.length)
      err(8);
    return s;
  }
}
var slzh = function(d, b) {
  return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
  var fnl = b2(d, b + 28), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl, bs = b4(d, b + 20);
  var _a2 = z && bs == 4294967295 ? z64e(d, es) : [bs, b4(d, b + 24), b4(d, b + 42)], sc = _a2[0], su = _a2[1], off = _a2[2];
  return [b2(d, b + 10), sc, su, fn, es + b2(d, b + 30) + b2(d, b + 32), off];
};
var z64e = function(d, b) {
  for (;b2(d, b) != 1; b += 4 + b2(d, b + 2))
    ;
  return [b8(d, b + 12), b8(d, b + 4), b8(d, b + 20)];
};
function unzipSync(data, opts) {
  var files = {};
  var e = data.length - 22;
  for (;b4(data, e) != 101010256; --e) {
    if (!e || data.length - e > 65558)
      err(13);
  }
  var c = b2(data, e + 8);
  if (!c)
    return {};
  var o = b4(data, e + 16);
  var z = o == 4294967295 || c == 65535;
  if (z) {
    var ze = b4(data, e - 12);
    z = b4(data, ze) == 101075792;
    if (z) {
      c = b4(data, ze + 32);
      o = b4(data, ze + 48);
    }
  }
  var fltr = opts && opts.filter;
  for (var i2 = 0;i2 < c; ++i2) {
    var _a2 = zh(data, o, z), c_2 = _a2[0], sc = _a2[1], su = _a2[2], fn = _a2[3], no = _a2[4], off = _a2[5], b = slzh(data, off);
    o = no;
    if (!fltr || fltr({
      name: fn,
      size: sc,
      originalSize: su,
      compression: c_2
    })) {
      if (!c_2)
        files[fn] = slc(data, b, b + sc);
      else if (c_2 == 8)
        files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
      else
        err(14, "unknown compression type " + c_2);
    }
  }
  return files;
}

// node_modules/tar-stream/index.js
var $extract = require_extract();
var $pack = require_pack();

// runtime/vnext/src/rg-tool.ts
import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
var RG_TOOLS_PATH = ".workflow-system/runtime/tools/rg";
var RG_VERSION = "15.2.0";
var RG_BINARY = process.platform === "win32" ? "rg.exe" : "rg";
function assertRgDirectory(root) {
  let directory = path.resolve(root);
  for (const part of RG_TOOLS_PATH.split("/")) {
    directory = path.join(directory, part);
    try {
      if (!fs.lstatSync(directory).isDirectory())
        throw new Error("RG_DEPENDENCY_PATH_INVALID: tool directory must not be a symlink or file.");
    } catch (error) {
      if (error.code !== "ENOENT")
        throw error;
    }
  }
  return directory;
}
function probeRg(command) {
  try {
    const version = execFileSync(command, ["--no-config", "--version"], { encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 4096 });
    const match = /^ripgrep (\d+\.\d+\.\d+)/u.exec(version);
    if (!match)
      return null;
    const [major, minor] = match[1].split(".").map(Number);
    return major === 14 && minor >= 1 || major === 15 ? match[1] : null;
  } catch {
    return null;
  }
}
function resolveRg(root) {
  const directory = assertRgDirectory(root);
  const command = path.join(directory, RG_BINARY);
  try {
    const identity = JSON.parse(fs.readFileSync(path.join(directory, "identity.json"), "utf8"));
    if (!fs.lstatSync(command).isSymbolicLink() && identity.sha256 === createHash("sha256").update(fs.readFileSync(command)).digest("hex")) {
      const version = probeRg(command);
      if (version && identity.version === version)
        return { command, version, source: "project" };
    }
  } catch {}
  for (const entry of (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter).filter(Boolean)) {
    const command2 = path.resolve(entry.replace(/^"|"$/gu, ""), RG_BINARY);
    if (!fs.existsSync(command2))
      continue;
    const version = probeRg(command2);
    if (version)
      return { command: command2, version, source: "path" };
  }
  throw new Error("RG_DEPENDENCY_MISSING: install or upgrade the Runtime distribution to prepare ripgrep; read-only commands do not download tools.");
}

// runtime/vnext/src/install-tools.ts
var RG_ASSETS = {
  "win32-x64": { target: "x86_64-pc-windows-msvc.zip", sha256: "71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5" },
  "win32-arm64": { target: "aarch64-pc-windows-msvc.zip", sha256: "e4abca10c3a64ebea742667dd7009449d49403db5460dd6873e389fa2945360f" },
  "linux-x64": { target: "x86_64-unknown-linux-musl.tar.gz", sha256: "33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c" },
  "linux-arm64": { target: "aarch64-unknown-linux-musl.tar.gz", sha256: "800b1e7206afe799dfb5a6901f23147cfaabe0e52210538100f61e86e1740915" },
  "darwin-x64": { target: "x86_64-apple-darwin.tar.gz", sha256: "af7825fcc69a2afc7a7aea55fc9af90e26421d8f20fe59df32e233c0b8a231c1" },
  "darwin-arm64": { target: "aarch64-apple-darwin.tar.gz", sha256: "3750b2e93f37e0c692657da574d7019a101c0084da05a790c83fd335bad973e4" }
};
var MAX_ARCHIVE = 8 * 1024 * 1024;
var MAX_EXTRACTED = 32 * 1024 * 1024;
async function downloadRg(url, fetcher = fetch) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body)
    throw new Error(`RG_DOWNLOAD_FAILED: HTTP ${response.status}`);
  const parts = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done)
        break;
      length += chunk.value.length;
      if (length > MAX_ARCHIVE)
        throw new Error("RG_DOWNLOAD_FAILED: archive exceeds size limit.");
      parts.push(Buffer.from(chunk.value));
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(parts);
}
async function extractRg(archive, asset) {
  if (archive.length > MAX_ARCHIVE || createHash2("sha256").update(archive).digest("hex") !== asset.sha256)
    throw new Error("RG_CHECKSUM_MISMATCH: downloaded archive is not the pinned release.");
  const prefix = `ripgrep-${RG_VERSION}-${asset.target.replace(/\.(zip|tar\.gz)$/u, "")}`;
  const expected = `${prefix}/${asset.target.endsWith(".zip") ? "rg.exe" : "rg"}`;
  let binary;
  let expanded = 0;
  const admit = (name, size) => {
    expanded += size;
    if (!Number.isSafeInteger(size) || size < 0 || expanded > MAX_EXTRACTED || name.includes("\\") || name.startsWith("/") || name.split("/").includes("..") || !name.startsWith(prefix + "/"))
      throw new Error("RG_ARCHIVE_INVALID: unsafe archive entry.");
    if (name === expected && binary)
      throw new Error("RG_ARCHIVE_INVALID: duplicate executable.");
    return name === expected;
  };
  if (asset.target.endsWith(".zip")) {
    const entries = unzipSync(archive, { filter: (file) => admit(file.name, file.originalSize) });
    if (entries[expected])
      binary = Buffer.from(entries[expected]);
  } else {
    const tar = $extract();
    await new Promise((resolve2, reject) => {
      tar.on("entry", (header, stream, next) => {
        try {
          if (header.type !== "file" && header.type !== "directory")
            throw new Error("RG_ARCHIVE_INVALID: links and special entries are forbidden.");
          const selected = admit(header.name.replace(/\/$/u, "") + (header.type === "directory" ? "/" : ""), header.size ?? 0);
          const chunks = [];
          stream.on("data", (chunk) => {
            if (selected)
              chunks.push(Buffer.from(chunk));
          });
          stream.on("error", reject);
          stream.on("end", () => {
            if (selected)
              binary = Buffer.concat(chunks);
            next();
          });
          stream.resume();
        } catch (error) {
          tar.destroy(error);
        }
      });
      tar.on("error", reject);
      tar.on("finish", resolve2);
      try {
        tar.end(gunzipSync(archive, { maxOutputLength: MAX_EXTRACTED }));
      } catch (error) {
        tar.destroy();
        reject(error);
      }
    });
  }
  if (!binary?.length || binary.length > MAX_EXTRACTED)
    throw new Error("RG_ARCHIVE_INVALID: release executable missing.");
  return binary;
}
function verifyRgFeatures(command, directory) {
  const fixture = path2.join(directory, "probe.txt");
  fs2.writeFileSync(fixture, `runtime-rg-probe
`);
  try {
    const options = { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 3000, maxBuffer: 8192 };
    const files = execFileSync2(command, ["--no-config", "--files", "--null", "--", fixture], options);
    if (!files.includes("probe.txt\x00"))
      throw new Error("RG_PROBE_FAILED: file listing.");
    const output = execFileSync2(command, ["--no-config", "--json", "--fixed-strings", "--", "runtime-rg-probe", fixture], options);
    if (!output.split(`
`).filter(Boolean).map((line) => JSON.parse(line)).some((event) => event.type === "match" && event.data.line_number === 1))
      throw new Error("RG_PROBE_FAILED: JSON match.");
    try {
      execFileSync2(command, ["--no-config", "--json", "--fixed-strings", "--", "missing-token", fixture], options);
      throw new Error("RG_PROBE_FAILED: no-match must exit 1.");
    } catch (error) {
      if (error.status !== 1)
        throw error;
    }
  } finally {
    fs2.unlinkSync(fixture);
  }
}
async function prepareRgTools(stageRoot, reuseRoot, fetcher = fetch) {
  const directory = assertRgDirectory(stageRoot);
  fs2.mkdirSync(directory, { recursive: true });
  try {
    const rg = resolveRg(reuseRoot);
    verifyRgFeatures(rg.command, directory);
    if (rg.source === "project") {
      fs2.copyFileSync(rg.command, path2.join(directory, RG_BINARY));
      fs2.copyFileSync(path2.join(path2.dirname(rg.command), "identity.json"), path2.join(directory, "identity.json"));
    } else
      fs2.writeFileSync(path2.join(directory, "identity.json"), JSON.stringify({ source: "path", version: rg.version }) + `
`);
    return { source: rg.source, version: rg.version };
  } catch {}
  const asset = RG_ASSETS[`${process.platform}-${process.arch}`];
  if (!asset)
    throw new Error("RG_PLATFORM_UNSUPPORTED: provide compatible ripgrep on PATH.");
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION}-${asset.target}`;
  const binary = await extractRg(await downloadRg(url, fetcher), asset);
  const command = path2.join(directory, RG_BINARY);
  fs2.writeFileSync(command, binary, { mode: 493 });
  if (probeRg(command) !== RG_VERSION)
    throw new Error("RG_PROBE_FAILED: unexpected release version.");
  verifyRgFeatures(command, directory);
  fs2.writeFileSync(path2.join(directory, "identity.json"), JSON.stringify({ source: "download", version: RG_VERSION, archive_sha256: asset.sha256, sha256: createHash2("sha256").update(binary).digest("hex") }) + `
`);
  return { source: "download", version: RG_VERSION };
}

// runtime/vnext/src/install-tools-cli.ts
var [stageRoot, reuseRoot] = process.argv.slice(2);
if (!stageRoot || !reuseRoot)
  throw new Error("Usage: install-tools <staging-root> <existing-project-root>");
prepareRgTools(path3.resolve(stageRoot), path3.resolve(reuseRoot)).then((result) => console.log(JSON.stringify(result))).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
