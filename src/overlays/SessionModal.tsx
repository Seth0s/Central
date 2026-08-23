// Create or edit a session-group: name, goal and the shared brief. The brief
// goes into the system prompt of the CLIs that accept one at spawn.

import type { Ref } from "react";
import { Folder, MessagesSquare, ScrollText, Tag, Target } from "lucide-react";
import { UiIcon } from "../icons";

export default function SessionModal({
  modalRef,
  editing,
  cwd,
  title,
  goal,
  brief,
  onTitle,
  onGoal,
  onBrief,
  onCancel,
  onSubmit,
}: {
  modalRef: Ref<HTMLDivElement>;
  editing: boolean;
  cwd: string;
  title: string;
  goal: string;
  brief: string;
  onTitle: (v: string) => void;
  onGoal: (v: string) => void;
  onBrief: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-root">
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal wide" role="dialog" aria-labelledby="session-title" ref={modalRef}>
        <h3 id="session-title">
          <UiIcon icon={MessagesSquare} size={20} />
          {editing ? "Editar sessão" : "Nova sessão"}
        </h3>
        <p>
          Grupo de agentes na mesma pasta. O brief é contexto comum; a pele ainda não encaminha
          mensagens entre processos.
        </p>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Tag} size={14} />
            Nome
          </span>
          <input
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Target} size={14} />
            Objectivo
          </span>
          <input
            value={goal}
            onChange={(e) => onGoal(e.target.value)}
            placeholder="O que este grupo está a resolver"
          />
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={ScrollText} size={14} />
            Brief partilhado
          </span>
          <textarea
            rows={4}
            value={brief}
            onChange={(e) => onBrief(e.target.value)}
            placeholder="Instruções comuns a todos os agentes desta sessão"
          />
          <span className="field-hint">
            Entra no system prompt dos CLIs que o aceitam. Mais tarde serve de base à orquestração,
            sem ser um canal entre PIDs.
          </span>
        </label>
        <label className="field">
          <span className="field-label">
            <UiIcon icon={Folder} size={14} />
            Pasta
          </span>
          <input value={cwd} readOnly className="readonly" />
        </label>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary" onClick={onSubmit}>
            {editing ? "Guardar" : "Criar sessão"}
          </button>
        </div>
      </div>
    </div>
  );
}
