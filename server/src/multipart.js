import express from "express";
import { httpError } from "./asyncRouter.js";

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");

function headerParam(header, name) {
  const m = new RegExp(`;\\s*${name}="([^"]*)"`, "i").exec(header) || new RegExp(`;\\s*${name}=([^;\\s]+)`, "i").exec(header);
  return m ? m[1] : undefined;
}

/**
 * Splits a buffered multipart/form-data body into text fields and files
 * (`{ filename, mimeType, size, text }`, text decoded as UTF-8). The first part of a repeated name wins.
 */
export function parseMultipart(buffer, contentType) {
  const m = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType || "");
  if (!m) throw httpError(400, "The multipart request has no boundary");
  const delimiter = Buffer.from(`--${(m[1] || m[2]).trim()}`);
  const fields = Object.create(null);
  const files = Object.create(null);
  const isClosing = (offset) => buffer[offset] === 0x2d && buffer[offset + 1] === 0x2d;
  const nextBoundary = (offset) => {
    let pos = buffer.indexOf(delimiter, offset);
    while (pos !== -1) {
      const end = pos + delimiter.length;
      const startsLine = pos === 0 || buffer.subarray(pos - 2, pos).equals(CRLF);
      const endsLine = buffer.subarray(end, end + 2).equals(CRLF);
      const closesBody = isClosing(end) &&
        (end + 2 === buffer.length || buffer.subarray(end + 2, end + 4).equals(CRLF));
      if (startsLine && (endsLine || closesBody)) return pos;
      pos = buffer.indexOf(delimiter, pos + delimiter.length);
    }
    return -1;
  };

  let pos = nextBoundary(0);
  if (pos === -1) throw httpError(400, "The multipart request has no valid boundary");
  while (!isClosing(pos + delimiter.length)) {
    const start = pos + delimiter.length + CRLF.length;
    const next = nextBoundary(start);
    if (next === -1) throw httpError(400, "The multipart request is incomplete");
    const part = buffer.subarray(start, next - CRLF.length);
    pos = next;

    const headerEnd = part.indexOf(HEADER_END);
    if (headerEnd === -1) throw httpError(400, "The multipart part has no header separator");
    const headers = part.subarray(0, headerEnd).toString("utf8");
    const content = part.subarray(headerEnd + HEADER_END.length);
    const disposition = /^content-disposition:([^\r\n]*)/mi.exec(headers)?.[1] || "";
    const name = headerParam(disposition, "name");
    if (name === undefined) throw httpError(400, "The multipart part has no name");
    const filename = headerParam(disposition, "filename");
    if (filename !== undefined) {
      if (!(name in files)) {
        files[name] = {
          filename,
          mimeType: /content-type:\s*([^\r\n]*)/i.exec(headers)?.[1]?.trim() || "application/octet-stream",
          size: content.length,
          text: content.toString("utf8"),
        };
      }
    } else if (!(name in fields)) {
      fields[name] = content.toString("utf8");
    }
  }
  return { fields, files };
}

/** Buffers multipart/form-data requests: req.body gets the text fields, req.files the files. */
export function multipartBody({ limit = "50mb" } = {}) {
  const raw = express.raw({ type: "multipart/form-data", limit });
  return (req, res, next) => {
    if (!req.is("multipart/form-data")) return next();
    raw(req, res, (err) => {
      if (err) return next(err);
      try {
        const { fields, files } = parseMultipart(
          Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
          req.headers["content-type"],
        );
        req.body = fields;
        req.files = files;
        next();
      } catch (parseErr) {
        next(parseErr);
      }
    });
  };
}
