import { Show, createSignal } from "solid-js";

export function ConfirmDeleteDialog(props: {
  chainId: string;
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  deleting: boolean;
  error: string | null;
}) {
  const [input, setInput] = createSignal("");

  const matches = () => input() === props.chainId;

  return (
    <Show when={props.open}>
      <div
        class="dialog-overlay"
        onClick={() => {
          props.onClose();
        }}
      >
        <div
          class="dialog"
          onClick={(e) => {
            e.stopPropagation();
          }}
        >
          <h3>Delete chain</h3>
          <p>
            This will permanently delete the chain and all its jobs. Type the chain ID to confirm:
          </p>
          <code class="dialog-chain-id">{props.chainId}</code>
          <input
            class="dialog-input"
            type="text"
            placeholder="Type chain ID..."
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && matches() && !props.deleting) props.onConfirm();
            }}
          />
          <Show when={props.error}>
            <div class="error-text">{props.error}</div>
          </Show>
          <div class="dialog-actions">
            <button
              class="dialog-btn-cancel"
              onClick={() => {
                props.onClose();
              }}
              disabled={props.deleting}
            >
              Cancel
            </button>
            <button
              class="dialog-btn-delete"
              disabled={!matches() || props.deleting}
              onClick={() => {
                props.onConfirm();
              }}
            >
              {props.deleting ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
