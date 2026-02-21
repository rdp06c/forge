// JSON response parser — ported from APEX trader.js (lines 4938-4991)
// 3-tier fallback: clean JSON → single-quote fix → structural extraction

/**
 * Escape literal newlines inside JSON string values
 */
function escapeNewlinesInJsonStrings(str) {
    let result = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (escaped) { result += ch; escaped = false; continue; }
        if (ch === '\\') { result += ch; escaped = true; continue; }
        if (ch === '"') { inString = !inString; result += ch; continue; }
        if (inString && ch === '\n') { result += '\\n'; continue; }
        if (inString && ch === '\r') { result += '\\r'; continue; }
        result += ch;
    }
    return result;
}

/**
 * Extract the decisions array via bracket matching (fallback)
 */
function extractDecisionsArray(text) {
    const start = text.indexOf('"decisions"');
    if (start === -1) throw new Error('No decisions key found');

    const arrStart = text.indexOf('[', start);
    if (arrStart === -1) throw new Error('No array start after decisions');

    let depth = 0;
    let arrEnd = arrStart;
    for (let i = arrStart; i < text.length; i++) {
        if (text[i] === '[') depth++;
        if (text[i] === ']') depth--;
        if (depth === 0) { arrEnd = i; break; }
    }

    let arrStr = text.substring(arrStart, arrEnd + 1);
    arrStr = arrStr.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
    arrStr = arrStr.replace(/,(\s*[}\]])/g, '$1');
    arrStr = escapeNewlinesInJsonStrings(arrStr);
    arrStr = arrStr.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    return JSON.parse(arrStr);
}

/**
 * Parse Claude's JSON response with 3-tier fallback
 * @param {string} rawText - Claude's raw text response
 * @returns {object} Parsed JSON with decisions array
 */
export function parseDecisionResponse(rawText) {
    let pj = rawText;

    // Extract from code fence (prefer last fence — web search can produce earlier ones)
    if (pj.includes('```json')) {
        const fIdx = pj.lastIndexOf('```json');
        const m = pj.substring(fIdx).match(/```json\s*([\s\S]*?)\s*```/);
        if (m) pj = m[1];
    } else if (pj.includes('```')) {
        const allM = [...pj.matchAll(/```\s*([\s\S]*?)\s*```/g)];
        if (allM.length > 0) pj = allM[allM.length - 1][1];
    }

    // Find outermost { ... }
    const si = pj.indexOf('{');
    if (si === -1) throw new Error('No JSON object found in response');

    let bc = 0, ei = si, ins = false, esc = false;
    for (let i = si; i < pj.length; i++) {
        if (esc) { esc = false; continue; }
        if (pj[i] === '\\') { esc = true; continue; }
        if (pj[i] === '"') { ins = !ins; continue; }
        if (!ins) {
            if (pj[i] === '{') bc++;
            if (pj[i] === '}') bc--;
            if (bc === 0) { ei = i; break; }
        }
    }

    let ps = pj.substring(si, ei + 1);
    ps = ps.replace(/<cite[^>]*>/g, '').replace(/<\/cite>/g, '');
    ps = ps.replace(/,(\s*[}\]])/g, '$1');
    ps = escapeNewlinesInJsonStrings(ps);
    ps = ps.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Tier 1: Clean parse
    try {
        return JSON.parse(ps);
    } catch (err1) {
        // Tier 2: Single-quote fix
        try {
            let ps2 = ps.replace(/'(\w+)':/g, '"$1":').replace(/:\s*'([^'\n]{0,200})'/g, ': "$1"');
            return JSON.parse(ps2);
        } catch {
            // Tier 3: Structural extraction
            const parsed = {};
            try {
                parsed.decisions = extractDecisionsArray(rawText);
            } catch { /* no decisions */ }

            const summaryMatch = rawText.match(/"holdings_summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (summaryMatch) parsed.holdings_summary = summaryMatch[1].replace(/\\n/g, '\n');

            const regimeMatch = rawText.match(/"market_regime"\s*:\s*"(bull|bear|choppy)"/i);
            if (regimeMatch) parsed.market_regime = regimeMatch[1].toLowerCase();

            if (!parsed.decisions) throw err1;
            return parsed;
        }
    }
}
