import '@testing-library/jest-dom'

// Mock ResizeObserver for all tests
class ResizeObserver {
  private targets: Element[] = [];
  
  observe(target: Element): void {
    if (!this.targets.includes(target)) {
      this.targets.push(target);
    }
  }
  
  unobserve(target: Element): void {
    const index = this.targets.indexOf(target);
    if (index !== -1) {
      this.targets.splice(index, 1);
    }
  }
  
  disconnect(): void {
    this.targets = [];
  }
}
globalThis.ResizeObserver = ResizeObserver;
