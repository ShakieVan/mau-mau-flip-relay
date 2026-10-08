// Ersatz für das Cloudflare-Modul „cloudflare:workers“ in Chrome (relay/test/core_test.html, Import-Map).
export class DurableObject {
	constructor(ctx, env) { this.ctx = ctx; this.env = env }
}
