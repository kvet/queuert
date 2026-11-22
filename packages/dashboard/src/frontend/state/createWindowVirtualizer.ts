import {
  type VirtualItem,
  Virtualizer,
  type VirtualizerOptions,
  measureElement,
  observeWindowOffset,
  observeWindowRect,
  windowScroll,
} from "@tanstack/virtual-core";
import { createEffect, createSignal, onSettled } from "solid-js";

export const createWindowVirtualizer = (options: {
  count: () => number;
  estimateSize: number;
  overscan?: number;
}): {
  listRef: (element: HTMLElement) => void;
  items: () => VirtualItem[];
  paddingTop: () => number;
  paddingBottom: () => number;
} => {
  const [state, setState] = createSignal(
    { items: [] as VirtualItem[], totalSize: 0, scrollMargin: 0 },
    { ownedWrite: true },
  );
  let list: HTMLElement | undefined;

  const publish = (instance: Virtualizer<Window, HTMLElement>) => {
    setState({
      items: instance.getVirtualItems(),
      totalSize: instance.getTotalSize(),
      scrollMargin: instance.options.scrollMargin,
    });
  };
  const items = () => state().items;

  const optionsFor = (count: number): VirtualizerOptions<Window, HTMLElement> => ({
    count,
    getScrollElement: () => window,
    estimateSize: () => options.estimateSize,
    scrollToFn: windowScroll,
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    measureElement,
    overscan: options.overscan ?? 8,
    scrollMargin: list ? list.getBoundingClientRect().top + window.scrollY : 0,
    onChange: publish,
  });

  const virtualizer = new Virtualizer<Window, HTMLElement>(optionsFor(0));

  const update = (count: number) => {
    virtualizer.setOptions(optionsFor(count));
    virtualizer._willUpdate();
    publish(virtualizer);
  };

  createEffect(options.count, update);

  createEffect(
    () => items(),
    (rendered) => {
      if (!list) return;
      const elements = Array.from(list.children) as HTMLElement[];
      elements.forEach((element, position) => {
        const item = rendered.at(position);
        if (!item) return;
        element.dataset.index = String(item.index);
        virtualizer.measureElement(element);
      });
    },
  );

  onSettled(() => {
    update(options.count());
    const unmount = virtualizer._didMount();
    const layout = new ResizeObserver(() => {
      update(options.count());
    });
    layout.observe(document.body);
    return () => {
      layout.disconnect();
      unmount();
    };
  });

  const firstStart = () => items().at(0)?.start ?? state().scrollMargin;
  const lastEnd = () => items().at(-1)?.end ?? state().scrollMargin;

  return {
    listRef: (element) => {
      list = element;
    },
    items,
    paddingTop: () => Math.max(0, firstStart() - state().scrollMargin),
    paddingBottom: () => Math.max(0, state().totalSize + state().scrollMargin - lastEnd()),
  };
};
