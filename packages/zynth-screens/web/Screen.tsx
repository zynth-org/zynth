import { registerWebComponent } from "@zynth/core";

// Inject CSS transitions for screens
if (typeof document !== "undefined" && !document.getElementById("zynth-screen-animations")) {
  const style = document.createElement("style");
  style.id = "zynth-screen-animations";
  style.textContent = `
    .zynth-screen {
      position: absolute;
      inset: 0;
      background-color: #ffffff;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transition: transform 400ms cubic-bezier(0.33, 1, 0.68, 1), 
                  opacity 400ms cubic-bezier(0.33, 1, 0.68, 1), 
                  border-radius 400ms ease;
      /* Default state: off-screen based on animation type */
      pointer-events: none;
      opacity: 0;
      z-index: 0;
    }

    /* Animation starting positions */
    .zynth-screen[data-anim="push"] { transform: translate3d(100%, 0, 0); opacity: 1; }
    .zynth-screen[data-anim="modal"] { transform: translate3d(0, 100%, 0); opacity: 1; }
    .zynth-screen[data-anim="fade"] { transform: none; opacity: 0; }
    .zynth-screen[data-anim="zoom"] { transform: scale(0.9); opacity: 0; }
    .zynth-screen[data-anim="none"] { transform: none; opacity: 1; }

    /* Active state: on-screen */
    .zynth-screen[data-active="true"] {
      transform: translate3d(0, 0, 0) scale(1);
      opacity: 1;
      pointer-events: auto;
      z-index: 100; /* Active screen on top */
    }

    /* Exiting state: keep it visible and on top while animating out */
    .zynth-screen[data-exiting="true"] {
      display: flex !important;
      z-index: 101; /* Exiting screen stays on top */
      pointer-events: none;
    }

    /* Covered state: Parallax shift and dimming */
    .zynth-screen[data-active="true"][data-covered="true"] {
      transform: translate3d(-10%, 0, 0);
      z-index: 0; /* Move to back */
      pointer-events: none;
    }

    /* Dimmer overlay for covered screens */
    .zynth-screen[data-active="true"][data-covered="true"]::after {
      content: '';
      position: absolute;
      inset: 0;
      background: black;
      opacity: 0.25;
      pointer-events: none;
      transition: opacity 400ms cubic-bezier(0.33, 1, 0.68, 1);
      z-index: 1000;
    }
    
    /* Ensure dimmer fades out when not covered */
    .zynth-screen[data-active="true"][data-covered="false"]::after {
      content: '';
      position: absolute;
      inset: 0;
      background: black;
      opacity: 0;
      pointer-events: none;
      transition: opacity 400ms cubic-bezier(0.33, 1, 0.68, 1);
      z-index: 1000;
    }
  `;
  document.head.appendChild(style);
}

registerWebComponent("zynth-screen", {
  create: () => {
    const el = document.createElement("div");
    el.classList.add("zynth-screen");
    
    // Handle lifecycle events via transitionend
    el.addEventListener("transitionend", (e) => {
      if (e.target !== el) return;
      
      const isActive = el.getAttribute("data-active") === "true";
      const isExiting = el.getAttribute("data-exiting") === "true";
      const props = (el as any).__zynth_props;
      
      if (isActive) {
        props?.onDidAppear?.();
      } else if (isExiting) {
        // Animation finished, hide element and clear exiting state
        props?.onDidDisappear?.();
        el.style.display = "none";
        el.removeAttribute("data-exiting");
      }
    });

    return el;
  },
  updateProp: (el, key, value) => {
    if (key === "active") {
      const isNowActive = !!value;
      const wasActive = el.getAttribute("data-active") === "true";
      
      if (isNowActive !== wasActive) {
        const props = (el as any).__zynth_props;
        if (isNowActive) {
          // Entering
          el.style.display = "flex";
          el.removeAttribute("data-exiting");
          props?.onWillAppear?.();
          
          // If animation is "none", set active immediately to avoid flash
          if (el.getAttribute("data-anim") === "none") {
             el.setAttribute("data-active", "true");
          } else {
             // Small delay to ensure the browser captures the "from" state before transitioning
             requestAnimationFrame(() => {
               el.setAttribute("data-active", "true");
             });
          }
        } else {
          // Exiting
          props?.onWillDisappear?.();
          el.setAttribute("data-active", "false");
          
          if (el.getAttribute("data-anim") !== "none") {
            el.setAttribute("data-exiting", "true");
            // Ensure display stays flex during exit animation
            el.style.display = "flex"; 
          } else {
            el.style.display = "none";
            props?.onDidDisappear?.();
          }
        }
      }
      return true;
    }
    if (key === "animation") {
      el.setAttribute("data-anim", value || "none");
      return true;
    }
    if (key === "covered") {
      // Use requestAnimationFrame to sync covered state changes with navigation
      // This prevents the background screen from jumping before the foreground one starts moving
      requestAnimationFrame(() => {
        el.setAttribute("data-covered", value ? "true" : "false");
      });
      return true;
    }
    return false;
  }
});
