"use strict";

function createDropdown(select) {
  const trigger = document.createElement("button");
  const menu = document.createElement("div");
  const label = select.getAttribute("aria-label");
  trigger.type = "button";
  trigger.className = "dropdown-trigger";
  trigger.setAttribute("aria-label", label);
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-controls", `${select.id}-menu`);
  trigger.setAttribute("aria-expanded", "false");
  menu.id = `${select.id}-menu`;
  menu.className = "dropdown-menu";
  menu.setAttribute("role", "listbox");
  menu.setAttribute("aria-label", label);
  menu.hidden = true;

  const options = Array.from(select.options, (option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.tabIndex = -1;
    button.textContent = option.text;
    button.setAttribute("role", "option");
    button.addEventListener("click", () => {
      select.selectedIndex = index;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      close(true);
    });
    return button;
  });
  menu.append(...options);
  document.body.append(menu);
  select.after(trigger);
  select.hidden = true;

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function sync() {
    const index = select.selectedIndex;
    trigger.disabled = select.disabled;
    trigger.textContent = select.options[index].text;
    trigger.setAttribute("aria-label", `${label}: ${trigger.textContent}`);
    options.forEach((option, i) =>
      option.setAttribute("aria-selected", String(i === index)),
    );
    if (select.disabled) close();
  }

  function open() {
    if (trigger.disabled) return;
    const bounds = trigger.getBoundingClientRect();
    menu.style.minWidth = `${bounds.width}px`;
    menu.hidden = false;
    const left = Math.max(
      4,
      Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 4),
    );
    const below = bounds.bottom + 4;
    const top =
      below + menu.offsetHeight <= window.innerHeight - 4
        ? below
        : bounds.top - menu.offsetHeight - 4;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(4, top)}px`;
    trigger.setAttribute("aria-expanded", "true");
    options[select.selectedIndex].focus({ preventScroll: true });
  }

  trigger.addEventListener("click", () => (menu.hidden ? open() : close(true)));
  trigger.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open();
  });
  menu.addEventListener("keydown", (event) => {
    const index = options.indexOf(document.activeElement);
    if (index >= 0 && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      options[index].click();
      return;
    }
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      close(true);
      return;
    }
    const target = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: options.length - 1,
    }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    options[Math.max(0, Math.min(options.length - 1, target))].focus({
      preventScroll: true,
    });
  });
  menu.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== trigger && !menu.contains(event.relatedTarget))
      close();
  });
  document.addEventListener("pointerdown", (event) => {
    if (!trigger.contains(event.target) && !menu.contains(event.target))
      close();
  });
  window.addEventListener("resize", () => close());
  select.addEventListener("change", sync);
  sync();
  return sync;
}
