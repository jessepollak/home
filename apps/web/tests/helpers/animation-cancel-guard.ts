export function guardAnimationCancellation(): void {
  const cancel = Animation.prototype.cancel;
  Animation.prototype.cancel = function (this: Animation) {
    void this.finished.catch(() => {});
    cancel.call(this);
  };
}
