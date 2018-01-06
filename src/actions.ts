/// <reference path="manipulations.ts" />
/// <reference path="assert.ts" />
/// <reference path="system.ts" />

interface WindowActions {
	moveAction(direction: number, axis: Axis): Function
	resizeAction(direction: number, axis: Axis): Function
	switchWorkspace(diff: number): Function
	moveWindowWorkspace(diff: number): Function
	selectWindow(diff: number): Function
	swapWindow(diff: number): Function
	toggleMaximize(): void
	minimize(): void
	unminimize(): void
	distribute(): void
}

module WindowActions {
	export function Make<WindowType>(Sys: System<WindowType>): WindowActions {
		function windowManipulator(fn: (r: Rect, bounds: Rect) => Rect): Function {
			return function() {
				const win = Sys.currentWindow();
				if (win == null) {
					p("no current window");
					return;
				}
				const newRect = fn(
					Sys.windowRect(win),
					Sys.workspaceArea(win));
				Sys.moveResize(win, newRect);
				Sys.activateLater(win);
			}
		}

		function moveAction(direction: number, axis: Axis): Function {
			return windowManipulator(Manipulations.move(direction, axis));
		}

		function resizeAction(direction: number, axis: Axis): Function {
			return windowManipulator(Manipulations.resize(direction, axis));
		}

		function withWorkspaceDiff(diff: number, fn: (idx: number) => void): void {
			const workspaceIdx = Sys.workspaceIndex();
			const numWorkspaces = Sys.numWorkspaces();
			const newIdx = workspaceIdx + diff;
			if (newIdx < 0 || newIdx >= numWorkspaces) return;
			fn(newIdx);
		}

		function switchWorkspace(diff: number) {
			return function() {
				withWorkspaceDiff(diff, function(idx: number) {
					Sys.activateWorkspace(idx)
				});
			}
		}

		function moveWindowWorkspace(diff: number) {
			return function() {
				const win = Sys.currentWindow();
				if (win === null) return;
				withWorkspaceDiff(diff, function(idx: number) {
					Sys.moveWindowToWorkspace(win, idx);
				})
			}
		}

		function toggleMaximize() {
			const win = Sys.currentWindow();
			if (win === null) return;
			if (Sys.getMaximized(win)) {
				Sys.unmaximize(win);
			} else {
				Sys.maximize(win);
			}
			Sys.activateLater(win);
		}

		function minimize() {
			const win = Sys.currentWindow();
			if (win === null) return;
			Sys.minimize(win);
		}

		function unminimize() {
			const minimized = Sys.minimizedWindows();
			// TODO: sort by last minimized?
			const win = minimized[0];
			if (!win) return;
			Sys.unminimize(win);
			Sys.activateLater(win);
		}

		function radialSortOrder(rect: Rect, screenMidpoint: Point) {
			const midpoint = Rect.midpoint(rect);
			const vector = Point.subtract(screenMidpoint, midpoint);
			const half_pi = Math.PI / 2;
			const tao = Math.PI * 2;

			var angle;
			if (Point.eqTo(vector, 0, 0)) {
				angle = -half_pi;
			} else {
				// atan2 gives angles in the range -PI (pointing due left) through to +PI, anti-clockwise
				angle = Math.atan2(vector.y, vector.x);
			}

			// shift angles to all be negative, then negate them to make clockwise
			angle = (angle + Math.PI);

			// take a slice on the left, just below horizontal and shift it into negative
			// so that it's ordered first
			if (angle > ((31/32) * tao)) {
				angle -= tao;
			}

			// p("sort order for window " + item + ":")
			// p("sort order window rect = " + JSON.stringify(item.desired_rect()) + ", midpoint = " + JSON.stringify(midpoint));
			// p("sort order angle = " + angle + ", vector = " + JSON.stringify(vector));
			// p("sort order ...");

			return angle;
		}

		class SortableWindow {
			win: WindowType
			order: number
			private _stableSequence: number

			constructor(win: WindowType, midpoint: Point) {
				this.win = win;
				this.order = radialSortOrder(Sys.windowRect(win), midpoint);
				this._stableSequence = null;
			}

			stableSequence(): number {
				if (this._stableSequence === null) {
					this._stableSequence = Sys.stableSequence(this.win);
				}
				return this._stableSequence;
			}
		}

		function withWindowPair(diff: number, fn: (a: WindowType, b: WindowType) => void): void {
			const [win, visibleWindows] = Sys.visibleWindows();
			if (win === null) return;

			const workArea = Sys.workspaceArea(win);
			const screenMidpoint = Rect.midpoint(workArea);

			const windows = (visibleWindows
				.map(function(w: WindowType) { return new SortableWindow(w, screenMidpoint); })
				.sort(function(a: SortableWindow, b: SortableWindow) {
					if (a.order === b.order) {
						// ensure a stable sort by using index position for equivalent windows
						return a.stableSequence() - b.stableSequence();
					} else {
						return a.order - b.order;
					}
				})
			);

			var windowIdx = -1;
			for (let i=0; i<windows.length; i++) {
				if(windows[i].win === win) {
					windowIdx = i;
					break;
				}
			}
			if (windowIdx === -1) {
				p("current window not found in visible windows")
				return;
			}

			// p("windows (active="+ windowIdx +"): " + JSON.stringify(windows.map(function(w: SortableWindow) {
			// 	return [ Sys.windowTitle(w.win), w.order, w.stableSequence(), Rect.copy(Sys.windowRect(w.win))];
			// })));

			let newIdx = (windowIdx + diff) % windows.length;
			if (newIdx < 0) newIdx += windows.length;
			fn(win, windows[newIdx].win);
		}

		function selectWindow(diff: number) {
			return function() {
				withWindowPair(diff, function(_a: WindowType, b: WindowType) {
					Sys.activate(b);
				})
			}
		}

		function swapWindow(diff: number) {
			return function() {
				withWindowPair(diff, function(a: WindowType, b: WindowType) {
					const ar = Sys.windowRect(a);
					const br = Sys.windowRect(b);
					Sys.moveResize(b, ar);
					Sys.moveResize(a, br);
					Sys.activateLater(a); // necessary?
				})
			}
		}

		class RectMetrics {
			rect: Rect
			midpoint: Point
			size: number

			constructor(rect: Rect) {
				this.rect = rect;
				this.midpoint = Rect.midpoint(rect);
				this.size = rect.size.x * rect.size.y;
			}

			diff(other: RectMetrics) {
				const posDiff = Point.magnitude(Point.subtract(this.midpoint, other.midpoint));
				const sizeDiff = Math.abs(this.size - other.size);
				// positional jumps are more jarring than size ones, so prioritize
				// close positions over sizes
				return (posDiff * 2) + sizeDiff;
			}
		}

		class WindowMetrics {
			win: WindowType
			metrics: RectMetrics

			constructor(win: WindowType) {
				this.win = win;
				this.metrics = new RectMetrics(Sys.windowRect(win));
			}
		}

		class TileCandidate {
			match: WindowMetrics
			diff: number
			rect: Rect

			constructor(wins: Array<WindowMetrics>, rect: Rect) {
				this.rect = rect;
				const rectMetrics = new RectMetrics(rect);
				this.match = null;
				for (let i=0; i<wins.length; i++) {
					const win = wins[i];
					const diff = win.metrics.diff(rectMetrics);
					if (this.match === null || this.diff > diff) {
						this.diff = diff;
						this.match = win;
					}
				}
			}
		}

		function distribute() {
			const [currentWindow, windows] = Sys.visibleWindows();
			if (windows.length === 0) return;
			const bounds = Sys.workspaceArea(windows[0]);

			if (windows.length === 1) {
				Sys.maximize(windows[0]);
			} else {
				// TODO: scatter windows by selecting the closest matches for position+size
				// instead of just distributing by index

				const leftCount = Math.floor(windows.length / 2);
				const rightCount = windows.length - leftCount;
				const width = bounds.size.x / 2;
				const leftHeight = Math.floor(bounds.size.y / leftCount);
				const rightHeight = Math.floor(bounds.size.y / rightCount);

				const tiles = windows.map(function(_w: WindowType, i: number) {
					if (i < leftCount) {
						return {
							pos: {
								x: 0,
								y: i*leftHeight
							},
							size: { x: width, y: leftHeight },
						}
					} else {
						return {
							pos: {
								x: width,
								y: (i-leftCount)*rightHeight
							},
							size: { x: width, y: rightHeight },
						}
					}
				});

				const windowMetrics = windows.map(function(w: WindowType) {
					return new WindowMetrics(w);
				});

				const remainingTiles = tiles.slice();
				const remainingWindows = windowMetrics.slice();
				while(remainingTiles.length > 0) {
					// at each step, find the best match and apply it. Then remove that window & tile from
					// candidates, and repeat
					const candidates = remainingTiles.map(function(tile: Rect) {
						return new TileCandidate(remainingWindows, tile);
					});
					const bestCandidate = candidates.sort(function(a: TileCandidate, b: TileCandidate) {
						return a.diff - b.diff;
					})[0];

					// p("out of " + remainingWindows.length + ", the best candidate was '" +
					// 	bestCandidate.match.win.get_title() + "' for rect " +
					// 	JSON.stringify(bestCandidate.rect));

					const windowIdx = remainingWindows.indexOf(bestCandidate.match);
					const tileIdx = remainingTiles.indexOf(bestCandidate.rect);
					assert(windowIdx !== -1);
					assert(tileIdx !== -1);
					remainingWindows.splice(windowIdx, 1);
					remainingTiles.splice(tileIdx, 1);

					Sys.moveResize(bestCandidate.match.win, bestCandidate.rect);
				}
			}
			if (currentWindow !== null) Sys.activateLater(currentWindow);
		}

		return {
			moveAction, resizeAction, switchWorkspace, moveWindowWorkspace,
			toggleMaximize, minimize, unminimize, selectWindow, swapWindow, distribute
		};
	}
}
