import { describe, it } from 'node:test';
import assert from 'node:assert';

// Pengujian logika murni deteksi arah usap cerdas
describe('Smart-Gesture Recognition Logic', () => {
  const evaluateSwipe = (
    dx: number,
    dy: number,
    threshold = 40,
    axisRatio = 1.4
  ): 'left' | 'right' | 'up' | 'down' | null => {
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX >= threshold && absX >= absY * axisRatio) {
      return dx < 0 ? 'left' : 'right';
    }
    if (absY >= threshold && absY >= absX * axisRatio) {
      return dy < 0 ? 'up' : 'down';
    }
    return null;
  };

  it('mendeteksi usapan horizontal kiri dengan tepat', () => {
    assert.strictEqual(evaluateSwipe(-60, 10), 'left');
    assert.strictEqual(evaluateSwipe(-40, 0), 'left');
  });

  it('mendeteksi usapan horizontal kanan dengan tepat', () => {
    assert.strictEqual(evaluateSwipe(55, -15), 'right');
  });

  it('mendeteksi usapan vertikal atas dan bawah dengan tepat', () => {
    assert.strictEqual(evaluateSwipe(5, -60), 'up');
    assert.strictEqual(evaluateSwipe(-10, 70), 'down');
  });

  it('mengabaikan gerakan diagonal berlebih (anti-hijack scroll vertikal/horizontal)', () => {
    // Gerakan diagonal dengan sudut ~45 derajat (50px vs 50px) tidak valid sebagai swipe
    assert.strictEqual(evaluateSwipe(50, 50), null);
    assert.strictEqual(evaluateSwipe(50, 45), null);
  });

  it('mengabaikan sentuhan mikro/tap biasa yang di bawah ambang batas', () => {
    assert.strictEqual(evaluateSwipe(15, 10), null);
    assert.strictEqual(evaluateSwipe(-20, -5), null);
  });
});
