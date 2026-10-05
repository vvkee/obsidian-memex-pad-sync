// Pure-JS SHA-1 (no WebCrypto dependency — guaranteed to run in any WebView).
// Only used to compute git blob hashes for change detection.

export function sha1Hex(data: Uint8Array): string {
	const ml = data.length;
	const paddedLen = (((ml + 8) >> 6) + 1) << 6;
	const buf = new Uint8Array(paddedLen);
	buf.set(data);
	buf[ml] = 0x80;
	const view = new DataView(buf.buffer);
	view.setUint32(paddedLen - 8, Math.floor((ml * 8) / 0x100000000));
	view.setUint32(paddedLen - 4, (ml * 8) >>> 0);

	let h0 = 0x67452301;
	let h1 = 0xefcdab89;
	let h2 = 0x98badcfe;
	let h3 = 0x10325476;
	let h4 = 0xc3d2e1f0;

	const w = new Uint32Array(80);
	const rol = (x: number, n: number): number => ((x << n) | (x >>> (32 - n))) >>> 0;

	for (let off = 0; off < paddedLen; off += 64) {
		for (let t = 0; t < 16; t++) w[t] = view.getUint32(off + t * 4);
		for (let t = 16; t < 80; t++) w[t] = rol(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);

		let a = h0, b = h1, c = h2, d = h3, e = h4;
		for (let t = 0; t < 80; t++) {
			let f: number, k: number;
			if (t < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
			else if (t < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
			else if (t < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
			else { f = b ^ c ^ d; k = 0xca62c1d6; }
			const tmp = (rol(a, 5) + f + e + k + w[t]) >>> 0;
			e = d; d = c; c = rol(b, 30); b = a; a = tmp;
		}
		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}

	return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join('');
}

/** Git blob object hash: sha1("blob <len>\0" + content). */
export function gitBlobSha(data: Uint8Array): string {
	const head = new TextEncoder().encode(`blob ${data.length}\0`);
	const full = new Uint8Array(head.length + data.length);
	full.set(head, 0);
	full.set(data, head.length);
	return sha1Hex(full);
}
