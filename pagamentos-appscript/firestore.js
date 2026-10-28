// REST síncrono para Apps Script; request é injetado para testar sem rede.
export const SERVER_TIMESTAMP = Object.freeze({ servidor: "REQUEST_TIME" });

export function criarFirestoreRest({ projectId, request, baseUrl, carimbo = SERVER_TIMESTAMP }) {
  if (!projectId || typeof request !== "function") throw new Error("Informe o projeto e o transporte do Firestore.");
  const base = (baseUrl || `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`).replace(/\/$/, "");
  const prefixo = `projects/${projectId}/databases/(default)/documents/`;
  const marca = typeof carimbo === "function" ? carimbo() : carimbo;
  const stamp = (v) => v === SERVER_TIMESTAMP || (marca !== null && typeof marca === "object" && v === marca);
  const mapa = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)
    && [Object.prototype, null].includes(Object.getPrototypeOf(v));
  const campo = (partes) => partes.map((p) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(p) ? p : `\`${p.replace(/\\/g, "\\\\").replace(/`/g, "\\`")}\``).join(".");
  const partesDe = (v) => {
    if (typeof v !== "string" || !v || v.split(".").some((p) => !p)) throw new Error("Campo do Firestore inválido.");
    return v.split(".");
  };
  const caminho = (p, documento) => {
    if (typeof p !== "string" || !p || p.split("/").some((v) => !v || v === "." || v === "..") || (p.split("/").length % 2 === 0) !== documento) throw new Error("Caminho do Firestore inválido.");
    return p;
  };
  const urlDoc = (p) => `${base}/${p.split("/").map(encodeURIComponent).join("/")}`;
  const chamar = (url, body, method = "POST") => {
    const resposta = request(url, { method, ...(body !== undefined ? { body } : {}) });
    if (resposta && typeof resposta.then === "function") throw new Error("O transporte do Apps Script precisa ser síncrono.");
    return resposta;
  };

  function codificar(v, partes = [], transforms = null, mascara = null, emArray = false) {
    if (stamp(v)) {
      if (!transforms || emArray || !partes.length) throw new Error("Carimbo de servidor inválido neste valor.");
      transforms.push({ fieldPath: campo(partes), setToServerValue: "REQUEST_TIME" });
      return undefined;
    }
    if (v === undefined) throw new Error("O Firestore não aceita undefined.");
    if (v === null) { if (mascara) mascara.push(campo(partes)); return { nullValue: null }; }
    if (v instanceof Date) {
      if (!Number.isFinite(+v)) throw new Error("Data inválida para o Firestore.");
      if (mascara) mascara.push(campo(partes));
      return { timestampValue: v.toISOString() };
    }
    if (typeof v === "number") {
      if (!Number.isFinite(v)) throw new Error("O Firestore exige um número finito.");
      if (mascara) mascara.push(campo(partes));
      return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    }
    if (typeof v === "string" || typeof v === "boolean") {
      if (mascara) mascara.push(campo(partes));
      return typeof v === "string" ? { stringValue: v } : { booleanValue: v };
    }
    if (Array.isArray(v)) {
      if (mascara) mascara.push(campo(partes));
      return { arrayValue: { values: v.map((x) => codificar(x, partes, null, null, true)) } };
    }
    if (!mapa(v)) throw new Error("Valor não suportado pelo Firestore.");
    const fields = {};
    if (!Object.keys(v).length && mascara) mascara.push(campo(partes));
    for (const k of Object.keys(v)) {
      if (!k) throw new Error("Nome de campo vazio.");
      const valor = codificar(v[k], [...partes, k], transforms, mascara, emArray);
      if (valor !== undefined) Object.defineProperty(fields, k, { value: valor, enumerable: true, writable: true, configurable: true });
    }
    return { mapValue: { fields } };
  }
  function decodificar(v) {
    if ("nullValue" in v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v || "doubleValue" in v) {
      const n = Number(v.integerValue ?? v.doubleValue);
      if (!Number.isFinite(n)) throw new Error("Número inválido recebido do Firestore.");
      return n;
    }
    if ("timestampValue" in v) {
      const d = new Date(v.timestampValue);
      if (!Number.isFinite(+d)) throw new Error("Data inválida recebida do Firestore.");
      return d;
    }
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodificar);
    if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decodificar(x)]));
    throw new Error("Tipo não suportado recebido do Firestore.");
  }
  function snapshot(ref, documento) {
    return { id: ref.id, ref, exists: !!documento, data: () => documento ? decodificar({ mapValue: { fields: documento.fields || {} } }) : undefined };
  }
  function escrever(ref, dados, modo, merge) {
    if (!mapa(dados)) throw new Error("O documento precisa ser um objeto.");
    const transforms = [], mascara = [], fields = {};
    for (const k of Object.keys(dados)) {
      const partes = modo === "update" ? partesDe(k) : [k];
      const valor = codificar(dados[k], partes, transforms, merge ? mascara : null);
      if (modo === "update" && valor !== undefined) mascara.push(campo(partes));
      if (valor === undefined) continue;
      let alvo = fields;
      for (let n = 0; n < partes.length - 1; n++) {
        const chave = partes[n];
        if (!Object.hasOwn(alvo, chave)) Object.defineProperty(alvo, chave, { value: { mapValue: { fields: {} } }, enumerable: true });
        if (!alvo[chave].mapValue) throw new Error("Campos de atualização em conflito.");
        alvo = alvo[chave].mapValue.fields;
      }
      const ultimo = partes.at(-1);
      if (Object.hasOwn(alvo, ultimo)) throw new Error("Campos de atualização em conflito.");
      Object.defineProperty(alvo, ultimo, { value: valor, enumerable: true });
    }
    const write = { update: { name: prefixo + ref.path, fields } };
    if (merge || modo === "update") write.updateMask = { fieldPaths: [...new Set(mascara)] };
    if (transforms.length) write.updateTransforms = transforms;
    if (modo === "create" || modo === "update") write.currentDocument = { exists: modo === "update" };
    return write;
  }
  const apagar = (ref) => ({ delete: prefixo + ref.path });
  const confirmar = (writes, transaction) => chamar(`${base}:commit`, { writes, ...(transaction ? { transaction } : {}) });

  function lerDoc(ref, transaction) {
    if (transaction) {
      const rows = chamar(`${base}:batchGet`, { documents: [prefixo + ref.path], transaction });
      const row = rows.find((r) => r.found?.name === prefixo + ref.path || r.missing === prefixo + ref.path);
      if (!row) throw new Error("O Firestore não retornou o documento da transação.");
      return snapshot(ref, row.found);
    }
    try { return snapshot(ref, chamar(urlDoc(ref.path), undefined, "GET")); }
    catch (err) { if (err.status === 404) return snapshot(ref, null); throw err; }
  }
  function lerQuery(query, transaction) {
    const partes = query.path.split("/"), collectionId = partes.pop(), parent = partes.length ? urlDoc(partes.join("/")) : base;
    const structuredQuery = { from: [{ collectionId }] };
    const filtros = query.filtros.map(([field, op, value]) => ({ fieldFilter: { field: { fieldPath: campo(partesDe(field)) }, op: op === "==" ? "EQUAL" : "LESS_THAN_OR_EQUAL", value: codificar(value) } }));
    if (filtros.length) structuredQuery.where = filtros.length === 1 ? filtros[0] : { compositeFilter: { op: "AND", filters: filtros } };
    if (query.maximo !== undefined) structuredQuery.limit = query.maximo;
    const rows = chamar(`${parent}:runQuery`, { structuredQuery, ...(transaction ? { transaction } : {}) });
    const docs = rows.filter((r) => r.document).map((r) => {
      if (!r.document.name.startsWith(prefixo)) throw new Error("Documento recebido de outro projeto.");
      return snapshot(doc(r.document.name.slice(prefixo.length)), r.document);
    });
    return { docs, empty: !docs.length, size: docs.length };
  }
  function doc(path) {
    caminho(path, true);
    const ref = { path, id: path.split("/").at(-1), tipo: "doc" };
    return Object.assign(ref, {
      get: () => lerDoc(ref), set: (data, options = {}) => confirmar([escrever(ref, data, "set", options.merge === true)]),
      update: (data) => confirmar([escrever(ref, data, "update", false)]), delete: () => confirmar([apagar(ref)]),
    });
  }
  function collection(path, filtros = [], maximo) {
    caminho(path, false);
    const query = { path, filtros, maximo, tipo: "query" };
    return Object.assign(query, {
      where(field, op, value) {
        partesDe(field);
        if (!["==", "<="].includes(op)) throw new Error("Operador de consulta não suportado.");
        codificar(value);
        return collection(path, [...filtros, [field, op, value]], maximo);
      },
      limit(n) { if (!Number.isSafeInteger(n) || n < 1) throw new Error("Limite de consulta inválido."); return collection(path, filtros, n); },
      get: () => lerQuery(query),
    });
  }
  function runTransaction(fn) {
    for (let tentativa = 0; tentativa < 3; tentativa++) {
      const { transaction } = chamar(`${base}:beginTransaction`, {});
      if (!transaction) throw new Error("O Firestore não iniciou a transação.");
      const writes = [];
      const tx = {
        get(ref) { if (writes.length) throw new Error("Leia todos os documentos antes de escrever na transação."); return ref.tipo === "doc" ? lerDoc(ref, transaction) : lerQuery(ref, transaction); },
        create(ref, data) { writes.push(escrever(ref, data, "create", false)); return tx; },
        set(ref, data, options = {}) { writes.push(escrever(ref, data, "set", options.merge === true)); return tx; },
        update(ref, data) { writes.push(escrever(ref, data, "update", false)); return tx; },
        delete(ref) { writes.push(apagar(ref)); return tx; },
      };
      try {
        const resultado = fn(tx);
        if (resultado && typeof resultado.then === "function") throw new Error("A transação do Apps Script precisa ser síncrona.");
        confirmar(writes, transaction);
        return resultado;
      } catch (err) {
        try { chamar(`${base}:rollback`, { transaction }); } catch { /* manter o erro que originou o rollback */ }
        const aborted = err.code === "ABORTED" || err.error?.status === "ABORTED";
        if (err.status !== 409 || !aborted || tentativa === 2) throw err;
      }
    }
  }
  return { doc, collection, runTransaction };
}
