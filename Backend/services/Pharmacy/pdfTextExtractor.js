/**
 * pdfTextExtractor.js  (R7hr-16)
 *
 * Thin wrapper around the `pdf-parse` package. Extracts raw text from a
 * supplier-invoice PDF buffer so the downstream Anthropic vision/parse step
 * can work on a text-first representation (cheaper + more deterministic
 * than handing the LLM the raw binary).
 *
 * Contract:
 *   async extractPdfText(buffer) -> {
 *     text:      String     // trimmed concatenated text from every page
 *     pageCount: Number     // numpages reported by pdf-parse, 0 if unknown
 *     lineRows:  [String]   // text.split(/\r?\n/), trimmed, empties dropped
 *   }
 *
 * Errors (thrown Error with .code so the route can map cleanly):
 *   - BAD_INPUT          : caller passed something that is not a Buffer
 *   - PDF_PARSE_FAILED   : pdf-parse threw (corrupt / encrypted / not a PDF)
 *   - PDF_HAS_NO_TEXT    : the PDF parsed fine but yielded no extractable
 *                          text. Almost always a scanned image PDF. The
 *                          route should turn this into a clean 422 with a
 *                          "looks like a scanned image, please re-upload a
 *                          text PDF" message. OCR is intentionally out of
 *                          scope for this story.
 *
 * NOTE on the `pdf-parse` package on Windows:
 *   The package's index.js, when required, tries to read a sample test PDF
 *   from `pdf-parse/test/data/05-versions-space.pdf` if certain conditions
 *   are met (it's a long-standing self-test path in v1.x that occasionally
 *   trips ENOENT on fresh installs). If that happens at app boot, the
 *   documented workaround is to require the library's internal lib file
 *   instead:
 *       const pdfParse = require('pdf-parse/lib/pdf-parse.js');
 *   We prefer the top-level require on first run; only swap to the lib
 *   path if the install misbehaves. The fallback line is kept commented
 *   below for fast switching without code archaeology.
 */
// R7hr-16: top-level require is the preferred path; fall back to the
// internal lib file only if a fresh `npm install` of pdf-parse triggers
// the ENOENT-on-test-PDF bug at app boot.
const pdfParse = require("pdf-parse");
// R7hr-16: Windows ENOENT workaround (kept for reference, do not delete):
// const pdfParse = require('pdf-parse/lib/pdf-parse.js');

/**
 * R7hr-16: build a tagged Error the route can map to an HTTP status by code.
 */
function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

/**
 * R7hr-16: extract text from a PDF buffer.
 *
 * @param {Buffer} buf  in-memory PDF bytes (from multer memoryStorage)
 * @returns {Promise<{text:string, pageCount:number, lineRows:string[]}>}
 */
async function extractPdfText(buf) {
  // R7hr-16: defensive input check — multer.memoryStorage should always give
  // us a Buffer, but a misconfigured route could pass a stream or a string.
  if (!Buffer.isBuffer(buf)) {
    throw _err("BAD_INPUT", "extractPdfText: buffer required");
  }

  // R7hr-16: parse step — wrap so pdf-parse's raw errors don't bubble up
  // unstructured. Corrupt / encrypted / non-PDF inputs all land here.
  let parsed;
  try {
    parsed = await pdfParse(buf);
  } catch (err) {
    throw _err(
      "PDF_PARSE_FAILED",
      "PDF_PARSE_FAILED: " + (err && err.message ? err.message : String(err))
    );
  }

  // R7hr-16: normalise text — pdf-parse returns `.text` as a single big
  // string with embedded \n separators. Trim outer whitespace so the empty
  // detection below is honest.
  const text = String((parsed && parsed.text) || "").trim();

  // R7hr-16: a syntactically valid PDF with zero extractable text is
  // almost always a scanned image. We surface this as its own code so the
  // route emits 422 with a human-readable "please upload a text PDF"
  // message. Intentionally no OCR fallback — separate future story.
  if (!text) {
    throw _err("PDF_HAS_NO_TEXT", "PDF_HAS_NO_TEXT (scanned image?)");
  }

  // R7hr-16: lineRows — useful for the downstream matcher / LLM prompt
  // builder so it can iterate row-by-row without re-splitting the blob.
  // Trim each line and drop empties; preserves order.
  const lineRows = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    text,
    pageCount: (parsed && parsed.numpages) || 0,
    lineRows,
  };
}

module.exports = { extractPdfText };
