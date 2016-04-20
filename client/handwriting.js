// Helper methods used by the handwriting class.

const kCanvasSize = 512;
const kDoubleClickTimeout = 300;

const kCrossWidth = 1 / 256;
const kMinDistance = 1 / 32;
const kStrokeWidth = 1 / 32;

const kBrushColor   = '#888888';
const kFailureColor = '#ff4d4d';
const kHintColor    = '#0080ff';
const kRevealColor  = '#cccccc';
const kStrokeColor  = '#000000';
const kSuccessColor = '#4dc84d';

const angle = (xs) => Math.atan2(xs[1][1] - xs[0][1], xs[1][0] - xs[0][0]);

const animate = (shape, size, rotate, source, target) => {
  shape.regX = size * (target[0][0] + target[1][0]) / 2;
  shape.regY = size * (target[0][1] + target[1][1]) / 2;
  shape.x = size * (source[0][0] + source[1][0]) / 2;
  shape.y = size * (source[0][1] + source[1][1]) / 2;
  const scale = distance(source) / (distance(target) + kMinDistance);
  shape.scaleX = scale;
  shape.scaleY = scale;
  if (rotate) {
    const rotation = (180 / Math.PI) * (angle(source) - angle(target));
    shape.rotation = ((Math.round(rotation) + 180) % 360) - 180;
  }
  return {rotation: 0, scaleX: 1, scaleY: 1, x: shape.regX, y: shape.regY};
}

const convertShapeStyles = (shape, start, end) => {
  if (!shape.graphics || !shape.graphics.instructions) {
    return;
  }
  let updated = false;
  for (let instruction of shape.graphics.instructions) {
    if (instruction.style === start) {
      instruction.style = end;
      updated = true;
    }
  }
  if (updated) shape.updateCache();
}

const createSketch = (element, handwriting) => {
  let mousedown = false;
  Sketch.create({
    container: element[0],
    autoclear: false,
    fullscreen: false,
    width: kCanvasSize,
    height: kCanvasSize,
    mousedown(e) {
      mousedown = true;
      handwriting._pushPoint([e.x, e.y]);
    },
    mouseup(e) {
      mousedown = false;
      handwriting._endStroke();
    },
    touchmove() {
      if (mousedown && this.touches.length > 0) {
        const touch = this.touches[0];
        handwriting._maybePushPoint([touch.ox, touch.oy]);
        handwriting._pushPoint([touch.x, touch.y]);
      }
    }
  });
  const canvas = element.find('canvas')[0];
  canvas.style.width = `${element.width()}px`;
  canvas.style.height = `${element.width()}px`;
  return element.width() / kCanvasSize;
}

const distance = (xs) => {
  const diff = [xs[1][0] - xs[0][0], xs[1][1] - xs[0][1]];
  return Math.sqrt(diff[0] * diff[0] + diff[1] * diff[1]);
}

const dottedLine = (width, x1, y1, x2, y2) => {
  const result = new createjs.Shape;
  result.graphics.setStrokeDash([width, width], 0);
  result.graphics.setStrokeStyle(width)
  result.graphics.beginStroke('#ccc');
  result.graphics.moveTo(x1, y1);
  result.graphics.lineTo(x2, y2);
  return result;
}

const midpoint = (point1, point2) => {
  return [(point1[0] + point2[0]) / 2, (point1[1] + point2[1]) / 2];
}

const pathToShape = (path, size, color, uncached) => {
  const scale = 1024 / size;
  const result = new createjs.Shape;
  const graphics = result.graphics;
  result.graphics.beginFill(color);
  result.graphics.beginStroke(color);
  const tokens = path.split(' ');
  let index = 0;
  const next = () => {
    index += 2;
    let result = [tokens[index - 2], tokens[index - 1]];
    result = result.map((x) => parseInt(x, 10));
    result[1] = 900 - result[1];
    return result.map((x) => Math.round(x / scale));
  }
  while (index < tokens.length - 2) {
    index += 1;
    const command = tokens[index - 1];
    const point = next();
    if (command === 'M') {
      graphics.moveTo(point[0], point[1]);
    } else if (command === 'L') {
      graphics.lineTo(point[0], point[1]);
    } else if (command === 'Q') {
      const end = next();
      graphics.curveTo(point[0], point[1], end[0], end[1]);
    } else {
      console.error(`Invalid command: ${command}`);
    }
  }
  if (!uncached) result.cache(0, 0, size, size);
  return result;
}

const renderCross = (size, container) => {
  const stroke = size * kCrossWidth;
  container.addChild(dottedLine(stroke, 0, 0, size, size));
  container.addChild(dottedLine(stroke, size, 0, 0, size));
  container.addChild(dottedLine(stroke, size / 2, 0, size / 2, size));
  container.addChild(dottedLine(stroke, 0, size/ 2, size, size / 2));
  container.cache(0, 0, size, size);
}

// A helper brush class that allows us to draw nice ink facsimiles.

class BasicBrush {
  constructor(container, point, options) {
    options = options || {};
    this._color = options.color || kBrushColor;
    this._width = options.width || 1;

    this._shape = new createjs.Shape;
    this._endpoint = point;
    this._midpoint = null;
    container.addChild(this._shape);
  }
  advance(point) {
    const last_endpoint = this._endpoint;
    const last_midpoint = this._midpoint;
    this._endpoint = point;
    this._midpoint = midpoint(last_endpoint, this._endpoint);
    if (last_midpoint) {
      this._draw(last_midpoint, this._midpoint, last_endpoint);
    } else {
      this._draw(last_endpoint, this._midpoint);
    }
  }
  _draw(point1, point2, control) {
    const graphics = this._shape.graphics;
    graphics.setStrokeStyle(this._width, 'round');
    graphics.beginStroke(this._color);
    graphics.moveTo(point1[0], point1[1]);
    if (control) {
      graphics.curveTo(control[0], control[1], point2[0], point2[1]);
    } else {
      graphics.lineTo(point2[0], point2[1]);
    }
  }
}

// Methods for actually executing drawing commands.

const Layer = {
  CROSS: 0,
  WATERMARK: 1,
  HIGHLIGHT: 2,
  COMPLETE: 3,
  HINT: 4,
  STROKE: 5,
  WARNING: 6,
  ALL: 7,
};

this.makemeahanzi.Handwriting = class Handwriting {
  constructor(element, options) {
    this._onclick = options.onclick;
    this._ondouble = options.ondouble;
    this._onstroke = options.onstroke;

    this._zoom = createSketch(element, this);
    this._stage = new createjs.Stage(element.find('canvas')[0]);
    this._size = this._stage.canvas.width;

    this._layers = [];
    for (let i = 0; i < Layer.ALL; i++) {
      const layer = new createjs.Container;
      this._layers.push(layer);
      this._stage.addChild(layer);
    }
    renderCross(this._size, this._layers[Layer.CROSS]);

    this._pending_animations = 0;
    this._running_animations = 0;
    this._reset();

    createjs.Ticker.setFPS(60);
    createjs.Ticker.removeAllEventListeners();
    createjs.Ticker.addEventListener('tick', this.tick.bind(this));
  }
  clear() {
    createjs.Tween.removeAllTweens();
    for (let layer of this._layers) {
      layer.removeAllChildren();
    }
    this._pending_animations = 0;
    this._running_animations = 0;
    this._reset();
  }
  emplace(path, rotate, source, target) {
    const child = pathToShape(path, this._size, kStrokeColor);
    const endpoint = animate(child, this._size, rotate, source, target);
    this._layers[Layer.STROKE].children.pop();
    this._layers[Layer.COMPLETE].addChild(child);
    this._animate(child, endpoint, 150);
  }
  fade() {
    const stroke = this._layers[Layer.STROKE];
    const child = stroke.children[stroke.children.length - 1];
    this._animate(child, {alpha: 0}, 150,
                  () => child.parent.removeChild(child));
  }
  flash(path) {
    const child = pathToShape(path, this._size, kHintColor);
    this._layers[Layer.HINT].addChild(child);
    this._animate(child, {alpha: 0}, 750,
                  () => child.parent.removeChild(child));
  }
  glow(success) {
    const color = success ? kSuccessColor : kFailureColor;
    for (let child of this._layers[Layer.COMPLETE].children) {
      convertShapeStyles(child, kStrokeColor, color);
    }
  }
  highlight(path) {
    if (this._layers[Layer.WATERMARK].children.length === 0) return;
    const layer = this._layers[Layer.HIGHLIGHT];
    for (let child of layer.children) {
      this._animate(child, {alpha: 0}, 150, () => layer.removeChild(child));
    }
    if (path) {
      const child = pathToShape(path, this._size, kHintColor);
      child.alpha = 0;
      layer.addChild(child);
      this._animate(child, {alpha: 1}, 150, () => {});
    }
  }
  reveal(paths) {
    const layer = this._layers[Layer.WATERMARK];
    if (layer.children.length > 0) return;
    const container = new createjs.Container;
    for (let path of paths) {
      const child = pathToShape(
          path, this._size, kRevealColor, true /* uncached */);
      container.addChild(child);
    }
    container.cache(0, 0, this._size, this._size);
    layer.addChild(container);
  }
  tick(event) {
    if (this._running_animations) {
      this._stage.update(event);
      this._running_animations -= this._pending_animations;
      this._pending_animations = 0;
    }
  }
  undo() {
    this._layers[Layer.STROKE].children.pop();
    this._reset();
  }
  warn(warning) {
    const child = new createjs.Text(warning, '48px Georgia', kHintColor);
    const bounds = child.getBounds();
    child.x = (kCanvasSize - bounds.width) / 2;
    child.y = kCanvasSize - 2 * bounds.height;
    child.cache(0, 0, this._size, this._size);
    this._layers[Layer.WARNING].removeAllChildren();
    this._layers[Layer.WARNING].addChild(child);
    this._animate(child, {alpha: 0}, 1500,
                  () => child.parent && child.parent.removeChild(child));
  }
  _animate(shape, target, duration, callback) {
    this._running_animations += 1;
    createjs.Tween.get(shape).to(target, duration).call(() => {
      this._pending_animations += 1;
      callback && callback();
    });
  }
  _click() {
    const timestamp = new Date().getTime();
    const cutoff = (this._last_click_timestamp || 0) + kDoubleClickTimeout;
    const handler = timestamp < cutoff ? this._ondouble : this._onclick;
    this._last_click_timestamp = timestamp;
    handler && handler();
  }
  _distance(point1, point2) {
    const diagonal = 2 * this._size * this._size;
    const diff = [point1[0] - point2[0], point1[1] - point2[1]];
    return (diff[0] * diff[0] + diff[1] * diff[1]) / diagonal;
  }
  _endStroke() {
    let handler = () => this._click();
    const layer = this._layers[Layer.STROKE];
    if (this._brush) {
      const stroke = this._stroke.map((x) => x.map((y) => y / this._size));
      if (distance([stroke[0], stroke[stroke.length - 1]]) > kMinDistance) {
        layer.children[layer.children.length - 1].cache(
            0, 0, this._size, this._size);
        handler = () => this._onstroke && this._onstroke(stroke);
      } else {
        layer.children.pop();
      }
    }
    handler();
    this._reset();
  }
  _maybePushPoint(point) {
    if (this._stroke.length === 0) {
      this._pushPoint(point);
    }
  }
  _pushPoint(point) {
    if (point[0] != null && point[1] != null) {
      this._stroke.push(point.map((x) => Math.round(x / this._zoom)));
      this._refresh();
    }
  }
  _refresh() {
    if (this._stroke.length < 2) {
      return;
    }
    const n = this._stroke.length;
    if (!this._brush) {
      const layer = this._layers[Layer.STROKE];
      const options = {width: this._size * kStrokeWidth};
      this._brush = new BasicBrush(layer, this._stroke[n - 2], options);
    }
    this._brush.advance(this._stroke[n - 1]);
    this._stage.update();
  }
  _reset() {
    this._brush = null;
    this._stroke = [];
    this._stage.update();
  }
}
