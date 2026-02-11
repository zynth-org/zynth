import type { SkiaGroupProps } from "./types";

const MATRIX_EPSILON = 1e-6;

export type Matrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
};

export const identityMatrix: Matrix2D = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  tx: 0,
  ty: 0,
};

function readNumber(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function multiplyMatrix(left: Matrix2D, right: Matrix2D): Matrix2D {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    tx: left.a * right.tx + left.c * right.ty + left.tx,
    ty: left.b * right.tx + left.d * right.ty + left.ty,
  };
}

export function translateMatrix(x: number, y: number): Matrix2D {
  return { a: 1, b: 0, c: 0, d: 1, tx: x, ty: y };
}

export function scaleMatrix(x: number, y: number): Matrix2D {
  return { a: x, b: 0, c: 0, d: y, tx: 0, ty: 0 };
}

export function rotateMatrix(radians: number): Matrix2D {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, tx: 0, ty: 0 };
}

export function applyMatrixPoint(matrix: Matrix2D, x: number, y: number): { x: number; y: number } {
  return {
    x: matrix.a * x + matrix.c * y + matrix.tx,
    y: matrix.b * x + matrix.d * y + matrix.ty,
  };
}

export function isNear(value: number, expected: number): boolean {
  return Math.abs(value - expected) <= MATRIX_EPSILON;
}

export function isAxisAligned(matrix: Matrix2D): boolean {
  return isNear(matrix.b, 0) && isNear(matrix.c, 0);
}

export function resolveGroupTransform(stateTransform: Matrix2D, props: SkiaGroupProps): Matrix2D {
  const translateX = readNumber(props.x) + readNumber(props.translateX);
  const translateY = readNumber(props.y) + readNumber(props.translateY);
  const uniformScale = props.scale == null ? 1 : readNumber(props.scale, 1);
  const scaleX = props.scaleX == null ? uniformScale : readNumber(props.scaleX, uniformScale);
  const scaleY = props.scaleY == null ? uniformScale : readNumber(props.scaleY, uniformScale);
  const rotate = readNumber(props.rotate);
  const originX = readNumber(props.originX);
  const originY = readNumber(props.originY);

  let local = translateMatrix(translateX, translateY);
  if (!isNear(originX, 0) || !isNear(originY, 0)) {
    local = multiplyMatrix(local, translateMatrix(originX, originY));
  }
  if (!isNear(rotate, 0)) {
    local = multiplyMatrix(local, rotateMatrix(rotate));
  }
  if (!isNear(scaleX, 1) || !isNear(scaleY, 1)) {
    local = multiplyMatrix(local, scaleMatrix(scaleX, scaleY));
  }
  if (!isNear(originX, 0) || !isNear(originY, 0)) {
    local = multiplyMatrix(local, translateMatrix(-originX, -originY));
  }

  return multiplyMatrix(stateTransform, local);
}

export function boundsFromPoints(points: readonly { x: number; y: number }[]) {
  if (points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = points[0]!.x;
  let maxY = points[0]!.y;
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index]!;
    if (point.x < minX) minX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.x > maxX) maxX = point.x;
    if (point.y > maxY) maxY = point.y;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

export function resolveCircleUniformScale(matrix: Matrix2D): number | null {
  const xAxisScale = Math.hypot(matrix.a, matrix.b);
  const yAxisScale = Math.hypot(matrix.c, matrix.d);
  const dot = matrix.a * matrix.c + matrix.b * matrix.d;
  if (!isNear(dot, 0)) return null;
  if (!isNear(xAxisScale, yAxisScale)) return null;
  return xAxisScale;
}
