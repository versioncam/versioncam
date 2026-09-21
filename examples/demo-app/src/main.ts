/**
 * The example app.
 *
 * Deliberately ordinary — a form, a list, a dialog — so that it never becomes
 * a second product and so the clips of it are about the recorder rather than
 * about anything clever here. It does have three properties on purpose:
 *
 *  - creating a shipment takes 800ms, so `settle()` has something real to
 *    absorb and a clip is not secretly testing an instant app;
 *  - that wait shows a CSS spinner, so animation scrubbing has something live
 *    to scrub;
 *  - the dialog is a native `<dialog>`, which is the kind of element that
 *    breaks naive automation.
 */

type Shipment = { id: number; who: string; where: string; tag: string };

const SEED: Shipment[] = [
  { id: 1, who: "Ada Whitfield", where: "Rotterdam", tag: "in transit" },
  { id: 2, who: "Bo Lindqvist", where: "Gothenburg", tag: "in transit" },
  { id: 3, who: "Chidi Okafor", where: "Lagos", tag: "customs" },
  { id: 4, who: "Dara Mensah", where: "Accra", tag: "in transit" },
  { id: 5, who: "Eve Ramanathan", where: "Chennai", tag: "delivered" },
  { id: 6, who: "Finn Halvorsen", where: "Bergen", tag: "in transit" },
  { id: 7, who: "Greta Novák", where: "Budapest", tag: "customs" },
  { id: 8, who: "Hugo Ferreira", where: "Porto", tag: "delivered" },
  { id: 9, who: "Iris Kowalski", where: "Gdańsk", tag: "in transit" },
  { id: 10, who: "Jonas Meier", where: "Basel", tag: "in transit" },
  { id: 11, who: "Kira Tanaka", where: "Osaka", tag: "delivered" },
  { id: 12, who: "Lars Jensen", where: "Aarhus", tag: "customs" },
];

let shipments = [...SEED];
let nextId = 13;
let pendingCancel: Shipment | null = null;

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

const list = byId<HTMLUListElement>("shipments");
const filter = byId<HTMLInputElement>("filter");
const listStatus = byId<HTMLParagraphElement>("list-status");
const form = byId<HTMLFormElement>("shipment-form");
const formStatus = byId<HTMLParagraphElement>("form-status");
const recipient = byId<HTMLInputElement>("recipient");
const destination = byId<HTMLInputElement>("destination");
const dialog = byId<HTMLDialogElement>("confirm");
const confirmDetail = byId<HTMLParagraphElement>("confirm-detail");

function render(): void {
  const needle = filter.value.trim().toLowerCase();
  const shown = needle
    ? shipments.filter((s) => s.where.toLowerCase().includes(needle))
    : shipments;

  list.replaceChildren(
    ...shown.map((s) => {
      const li = document.createElement("li");
      li.dataset.testid = `shipment-${s.id}`;
      if (s.id >= 13) li.classList.add("is-new");

      const who = document.createElement("span");
      who.className = "who";
      who.textContent = s.who;

      const where = document.createElement("span");
      where.className = "where";
      where.textContent = s.where;

      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = s.tag;

      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "quiet";
      cancel.textContent = "Cancel";
      cancel.setAttribute("aria-label", `Cancel shipment to ${s.where}`);
      cancel.dataset.testid = `cancel-${s.id}`;
      cancel.addEventListener("click", () => {
        pendingCancel = s;
        confirmDetail.textContent = `${s.who} — ${s.where}`;
        dialog.showModal();
      });

      li.append(who, where, tag, cancel);
      return li;
    }),
  );

  listStatus.textContent = needle
    ? `${shown.length} of ${shipments.length} shipments match “${filter.value.trim()}”`
    : `${shipments.length} shipments`;
}

filter.addEventListener("input", render);

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const who = recipient.value.trim();
  const where = destination.value.trim();
  if (!who || !where) {
    formStatus.textContent = "Both fields are required.";
    return;
  }

  // Slow on purpose: a clip should have to wait for something.
  formStatus.replaceChildren(
    Object.assign(document.createElement("span"), { className: "spinner" }),
    document.createTextNode("Creating shipment…"),
  );

  window.setTimeout(() => {
    shipments = [{ id: nextId++, who, where, tag: "in transit" }, ...shipments];
    recipient.value = "";
    destination.value = "";
    formStatus.textContent = `Created a shipment to ${where}.`;
    render();
  }, 800);
});

byId<HTMLButtonElement>("confirm").querySelector<HTMLButtonElement>(
  '[data-testid="confirm-keep"]',
)!.onclick = () => {
  pendingCancel = null;
  dialog.close();
};

byId<HTMLButtonElement>("confirm").querySelector<HTMLButtonElement>(
  '[data-testid="confirm-cancel"]',
)!.onclick = () => {
  if (pendingCancel) {
    shipments = shipments.filter((s) => s.id !== pendingCancel!.id);
    listStatus.textContent = `Cancelled the shipment to ${pendingCancel.where}.`;
    pendingCancel = null;
  }
  dialog.close();
  render();
};

render();
