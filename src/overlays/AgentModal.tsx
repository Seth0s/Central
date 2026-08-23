// Spawn an agent: pick a detected CLI and the documented spawn flags. Only
// providers found on PATH are selectable; `fixture` is always there.

import type { Ref } from "react";
import { Folder, FolderOpen, MessageSquarePlus, ScrollText, SquareCode, Tag } from "lucide-react";
import { providerIcon, UiIcon } from "../icons";
import type { ProviderInfo } from "../lib/commands";
import { PROVIDER_LABELS } from "../lib/slash";
import { labelOf } from "../lib/ui-model";

/** The modal's draft. `groupId` set means "add to this session-group". */
export type AgentForm = {
  provider: string;
  name: string;
  cwd: string;
  model: string;
  prompt: string;
  resumeId: string;
  continueLast: boolean;
  groupId: string | null;
};

export const EMPTY_AGENT_FORM: AgentForm = {
  provider: "fixture",
  name: "",
  cwd: "",
  model: "",
  prompt: "",
  resumeId: "",
  continueLast: false,
  groupId: null,
};

export default function AgentModal({
  modalRef,
  providers,
  form,
  onForm,
  cwdPlaceholder,
  onPickFolder,
  onCancel,
  onSubmit,
}: {
  modalRef: Ref<HTMLDivElement>;
  providers: ProviderInfo[];
  form: AgentForm;
  onForm: (patch: Partial<AgentForm>) => void;
  cwdPlaceholder: string;
  onPickFolder: () => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const anyDetected = providers.some((p) => p.detected);

  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal wide" role="dialog" aria-labelledby="agent-title" ref={modalRef}>
        <h3 id="agent-title">
          <UiIcon icon={MessageSquarePlus} size={20} />
          {form.groupId ? "Adicionar agente" : "Novo chat"}
        </h3>
        <p>Só CLIs detectados no PATH. O fixture está sempre disponível.</p>
        <div className="provider-pick">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={!p.detected}
              className={`opt ${form.provider === p.id ? "on" : ""} ${p.detected ? "" : "off"}`}
              onClick={() => {
                if (!p.detected) return;
                const renameable = !form.name || Object.values(PROVIDER_LABELS).includes(form.name);
                onForm({ provider: p.id, ...(renameable ? { name: labelOf(p.id) } : {}) });
              }}
            >
              <span className="opt-row">
                <UiIcon icon={providerIcon(p.id)} size={18} />
                {labelOf(p.id)}
              </span>
              <span className="opt-meta">{p.detected ? p.binary || "ok" : "ausente"}</span>
            </button>
          ))}
        </div>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Tag} size={14} />
            Nome
          </span>
          <input value={form.name} onChange={(e) => onForm({ name: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Folder} size={14} />
            Pasta
          </span>
          <div className="path-row">
            <input
              value={form.cwd}
              onChange={(e) => onForm({ cwd: e.target.value })}
              placeholder={cwdPlaceholder}
            />
            <button type="button" className="ghost" onClick={onPickFolder}>
              <UiIcon icon={FolderOpen} size={14} />
              Pasta
            </button>
          </div>
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={SquareCode} size={14} />
            Modelo (opcional)
          </span>
          <input
            value={form.model}
            onChange={(e) => onForm({ model: e.target.value })}
            placeholder="flags do vendor, se existirem"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={ScrollText} size={14} />
            System prompt
          </span>
          <textarea rows={3} value={form.prompt} onChange={(e) => onForm({ prompt: e.target.value })} />
        </label>
        <label className="field">
          <span className="field-label">Sessão vendor (opcional)</span>
          <input
            value={form.resumeId}
            onChange={(e) => onForm({ resumeId: e.target.value })}
            placeholder="id de --resume, se a conversa já existir"
          />
        </label>
        {form.provider === "claude" && (
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={form.continueLast}
              onChange={(e) => onForm({ continueLast: e.target.checked })}
            />
            <span>Continuar a última conversa nesta pasta</span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary" disabled={!anyDetected} onClick={onSubmit}>
            Iniciar
          </button>
        </div>
      </div>
    </div>
  );
}
