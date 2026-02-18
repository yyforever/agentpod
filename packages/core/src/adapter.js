export class AdapterRegistry {
    adapters = new Map();
    register(adapter) {
        this.adapters.set(adapter.meta.id, adapter);
    }
    get(id) {
        return this.adapters.get(id);
    }
    list() {
        return [...this.adapters.values()];
    }
}
//# sourceMappingURL=adapter.js.map