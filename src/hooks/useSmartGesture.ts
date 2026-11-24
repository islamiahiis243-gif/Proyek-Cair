import { useState, useRef, useCallback } from 'react';

export interface SmartGestureOptions {
  /** Ambang batas jarak minimal (pixel) untuk memicu swipe */
  threshold?: number;
  /** Rasio dominasi sumbu utama terhadap sumbu silang (default: 1.4) */
  axisRatio?: number;
  /** Mengaktifkan deteksi drag mouse di desktop selain touch */
  enableMouseDrag?: boolean;
  /** Callback saat usap ke kiri */
  onSwipeLeft?: () => void;
  /** Callback saat usap ke kanan */
  onSwipeRight?: () => void;
  /** Callback saat usap ke atas */
  onSwipeUp?: () => void;
  /** Callback saat usap ke bawah */
  onSwipeDown?: () => void;
}

export interface SmartGestureState {
  isSwiping: boolean;
  deltaX: number;
  deltaY: number;
  direction: 'left' | 'right' | 'up' | 'down' | null;
}

export function useSmartGesture<T extends HTMLElement = HTMLDivElement>(
  options: SmartGestureOptions = {}
) {
  const {
    threshold = 40,
    axisRatio = 1.4,
    enableMouseDrag = false,
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown
  } = options;

  const [state, setState] = useState<SmartGestureState>({
    isSwiping: false,
    deltaX: 0,
    deltaY: 0,
    direction: null
  });

  const startCoord = useRef<{ x: number; y: number; time: number } | null>(null);
  const isPointerDown = useRef(false);

  const handleStart = useCallback((clientX: number, clientY: number) => {
    isPointerDown.current = true;
    startCoord.current = { x: clientX, y: clientY, time: Date.now() };
    setState({
      isSwiping: true,
      deltaX: 0,
      deltaY: 0,
      direction: null
    });
  }, []);

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!isPointerDown.current || !startCoord.current) return;
      const dx = clientX - startCoord.current.x;
      const dy = clientY - startCoord.current.y;

      let dir: 'left' | 'right' | 'up' | 'down' | null = null;
      if (Math.abs(dx) > Math.abs(dy)) {
        dir = dx > 0 ? 'right' : 'left';
      } else if (Math.abs(dy) > Math.abs(dx)) {
        dir = dy > 0 ? 'down' : 'up';
      }

      setState({
        isSwiping: true,
        deltaX: dx,
        deltaY: dy,
        direction: dir
      });
    },
    []
  );

  const handleEnd = useCallback(() => {
    if (!isPointerDown.current || !startCoord.current) {
      isPointerDown.current = false;
      startCoord.current = null;
      setState({ isSwiping: false, deltaX: 0, deltaY: 0, direction: null });
      return;
    }

    isPointerDown.current = false;
    startCoord.current = null;

    setState((prev) => {
      const dx = prev.deltaX;
      const dy = prev.deltaY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      // Evaluasi gestur horizontal bersih (sumbu X dominan)
      if (absX >= threshold && absX >= absY * axisRatio) {
        if (dx < 0 && onSwipeLeft) {
          onSwipeLeft();
        } else if (dx > 0 && onSwipeRight) {
          onSwipeRight();
        }
      }
      // Evaluasi gestur vertikal bersih (sumbu Y dominan)
      else if (absY >= threshold && absY >= absX * axisRatio) {
        if (dy < 0 && onSwipeUp) {
          onSwipeUp();
        } else if (dy > 0 && onSwipeDown) {
          onSwipeDown();
        }
      }

      return {
        isSwiping: false,
        deltaX: 0,
        deltaY: 0,
        direction: null
      };
    });
  }, [threshold, axisRatio, onSwipeLeft, onSwipeRight, onSwipeUp, onSwipeDown]);

  // Event handlers untuk touch
  const onTouchStart = useCallback(
    (e: React.TouchEvent<T>) => {
      if (e.touches.length === 1) {
        handleStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    [handleStart]
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<T>) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    },
    [handleMove]
  );

  const onTouchEnd = useCallback(() => {
    handleEnd();
  }, [handleEnd]);

  // Event handlers untuk mouse (opsional)
  const onMouseDown = useCallback(
    (e: React.MouseEvent<T>) => {
      if (!enableMouseDrag || e.button !== 0) return;
      handleStart(e.clientX, e.clientY);
    },
    [enableMouseDrag, handleStart]
  );

  const onMouseMove = useCallback(
    (e: React.MouseEvent<T>) => {
      if (!enableMouseDrag || !isPointerDown.current) return;
      handleMove(e.clientX, e.clientY);
    },
    [enableMouseDrag, handleMove]
  );

  const onMouseUp = useCallback(() => {
    if (!enableMouseDrag) return;
    handleEnd();
  }, [enableMouseDrag, handleEnd]);

  const onMouseLeave = useCallback(() => {
    if (!enableMouseDrag || !isPointerDown.current) return;
    handleEnd();
  }, [enableMouseDrag, handleEnd]);

  return {
    state,
    gestureProps: {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      ...(enableMouseDrag
        ? {
            onMouseDown,
            onMouseMove,
            onMouseUp,
            onMouseLeave
          }
        : {})
    }
  };
}
