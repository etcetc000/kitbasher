import type { PackModel } from '../../engine/src/packs.js';
import { parameterHelp } from './parameters.js';

const dismissScreenHelp = (except?: Element) => {
  document.querySelectorAll<HTMLElement>('.lcd-interactive').forEach(frame => {
    if (except && frame.contains(except)) return;
    frame.querySelector<HTMLElement>('.lcd-tooltip')?.setAttribute('hidden', '');
    frame.querySelectorAll('[aria-describedby]').forEach(button => button.removeAttribute('aria-describedby'));
  });
};
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') dismissScreenHelp();
});
document.addEventListener('pointerdown', event => dismissScreenHelp(event.target as Element));

// Hit regions share the LCD's native 128 x 64 coordinates at every display scale.
export function addScreenHelp(canvas: HTMLCanvasElement, model: PackModel): void {
  let frame = canvas.parentElement!;
  if (!frame.classList.contains('lcd-interactive')) {
    const wrapper = document.createElement('div');
    wrapper.className = 'lcd-interactive';
    canvas.replaceWith(wrapper);
    wrapper.append(canvas);
    frame = wrapper;
  }
  frame.querySelectorAll('.lcd-hotspot,.lcd-tooltip').forEach(node => node.remove());
  const tooltip = document.createElement('div');
  tooltip.className = 'lcd-tooltip';
  tooltip.id = `${canvas.id}-help`;
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  const title = document.createElement('strong');
  const description = document.createElement('p');
  tooltip.append(title, description);
  let active: HTMLButtonElement | null = null;
  let timer: ReturnType<typeof setTimeout>;
  const hide = () => {
    clearTimeout(timer);
    tooltip.hidden = true;
    active?.removeAttribute('aria-describedby');
    active = null;
  };
  const deferHide = () => { timer = setTimeout(hide, 140); };
  const help = parameterHelp(model);
  model.labels.forEach((label, index) => {
    const entry = help.find(item => item.label === label);
    if (!entry) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'lcd-hotspot';
    button.setAttribute('aria-label', entry.name);
    button.style.cssText = `left:${(48 + index % 4 * 20) / 128 * 100}%;top:${Math.floor(index / 4) * 50}%;width:${20 / 128 * 100}%;height:50%`;
    const show = () => {
      clearTimeout(timer);
      active?.removeAttribute('aria-describedby');
      title.textContent = entry.name;
      description.textContent = entry.description;
      button.setAttribute('aria-describedby', tooltip.id);
      active = button;
      tooltip.hidden = false;
    };
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') show(); });
    button.addEventListener('pointerleave', deferHide);
    button.addEventListener('focus', show);
    button.addEventListener('blur', deferHide);
    button.addEventListener('click', show);
    frame.append(button);
  });
  tooltip.addEventListener('pointerenter', () => clearTimeout(timer));
  tooltip.addEventListener('pointerleave', deferHide);
  frame.onkeydown = event => { if (event.key === 'Escape') { hide(); event.stopPropagation(); } };
  frame.append(tooltip);
}
