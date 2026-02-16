import { cn } from '../../src/lib/utils';

describe('utils', () => {
  describe('cn', () => {
    it('should merge class names correctly', () => {
      expect(cn('c1', 'c2')).toBe('c1 c2');
    });

    it('should handle conditional classes', () => {
      // SonarQube suppression: constant truthiness is intentional for testing
      const getTrue = () => true;
      const getFalse = () => false;
      expect(cn('c1', getTrue() && 'c2', getFalse() && 'c3')).toBe('c1 c2');
    });

    it('should merge tailwind classes correctly', () => {
      expect(cn('p-4', 'p-2')).toBe('p-2');
      expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
    });

    it('should handle arrays and objects', () => {
      expect(cn(['c1', 'c2'], { c3: true, c4: false })).toBe('c1 c2 c3');
    });
  });
});
