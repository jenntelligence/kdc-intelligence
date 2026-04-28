# Design Docs

This folder captures **why** we build things — the durable principles and
beliefs that exec plans rely on. It does not capture **what** is being built
or **how** to build it; those go in `docs/exec-plans/`.

---

## Purpose

A design doc lives here when:

- Two or more exec plans rely on the same underlying principle, **or**
- The decision is expected to outlive the people currently on the project,
  **or**
- Reversing the decision would invalidate work in multiple parts of the
  codebase.

If a belief only matters for one feature, write it in that feature's exec
plan and move on. Don't pre-emptively promote it to a design doc.

---

## Index

| Doc | Summary |
|-----|---------|
| [core-beliefs.md](./core-beliefs.md) | The 6 principles this project will not violate without an explicit, documented exception. |

---

## Adding a new design doc

1. Confirm the trigger above (multiple exec plans depend on it).
2. Write the doc as a set of stated principles, each with a short rationale.
3. Add it to the index table above.
4. In any exec plan that depends on the principle, link to the relevant
   section.

If a design principle is later proven wrong, **amend the design doc as a
separate change before** writing the exec plan that contradicts it. Do not
quietly violate a stated principle inside an unrelated plan.
