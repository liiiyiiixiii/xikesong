// RFC4180 quoted commas/newlines, escaped quotes, BOM and CRLF are supported.
export function csvRows(text: string): Record<string, string>[] {
    const rows: string[][] = [];
    let row: string[] = [], cell = "", quoted = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else
                quoted = !quoted;
        }
        else if (c === ',' && !quoted) {
            row.push(cell);
            cell = "";
        }
        else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(cell);
            if (row.some(v => v.trim()))
                rows.push(row);
            row = [];
            cell = "";
        }
        else
            cell += c;
    }
    if (quoted)
        throw new Error("CSV引号未闭合");
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    const header = rows.shift()?.map(h => h.trim());
    if (!header?.length || new Set(header).size !== header.length)
        throw new Error("CSV表头缺失或重复");
    return rows.map((r, i) => { if (r.length !== header.length)
        throw new Error(`CSV第${i + 2}行列数不匹配`); return Object.fromEntries(header.map((k, j) => [k, r[j].trim()])); });
}
export function value(s: string | undefined): number | null { if (s === undefined || s === "" || s === "NA")
    return null; const n = Number(s); if (!Number.isFinite(n) || n < 0)
    throw new Error(`无效非负数：${s}`); return n; }
