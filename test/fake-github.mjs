/**
 * A stand-in for the gh command line that answers the calls the installer
 * makes, keeping repositories, boards, and fields in memory. Tests read its
 * state and its call log instead of touching GitHub.
 */

export class FakeGitHub {
  constructor({ installed = true, loggedIn = true, scopes = ["repo", "project", "read:org"], ownerType = "User",
    platform = "darwin", programs = ["brew"] } = {}) {
    Object.assign(this, { installed, loggedIn, scopes, ownerType, platform, programs });
    this.repos = new Map();
    this.boards = [];
    this.calls = [];
    this.runs = [];
    this.nextId = 1;
    this.gh = this.gh.bind(this);
  }

  id(prefix) {
    return `${prefix}_${this.nextId++}`;
  }

  repo(nameWithOwner) {
    if (!this.repos.has(nameWithOwner)) {
      this.repos.set(nameWithOwner, { id: this.id("R"), nameWithOwner, defaultBranch: "main", linked: new Set() });
    }
    return this.repos.get(nameWithOwner);
  }

  /** Add a board to the owner, optionally linked to a repository. */
  addBoard({ title, linkedTo = null, statuses = ["Todo", "In Progress", "Done"], iteration = null, closed = false }) {
    const board = {
      id: this.id("PVT"), number: this.boards.length + 1, title, closed,
      url: `https://github.com/users/acme/projects/${this.boards.length + 1}`,
      fields: [
        { id: this.id("F"), name: "Title", dataType: "TITLE" },
        { id: this.id("F"), name: "Status", dataType: "SINGLE_SELECT",
          options: statuses.map((name) => ({ id: this.id("O"), name, color: "GRAY", description: "" })) },
      ],
    };
    if (iteration) board.fields.push({ id: this.id("F"), name: iteration, dataType: "ITERATION",
      configuration: { duration: 7, startDate: "2026-09-21" } });
    this.boards.push(board);
    if (linkedTo) this.repo(linkedTo).linked.add(board.id);
    return board;
  }

  board(id) {
    return this.boards.find((b) => b.id === id);
  }

  mutations() {
    return this.calls.filter((c) => c.query?.trimStart().startsWith("mutation"));
  }

  gh(args, { input } = {}) {
    const call = { args };
    this.calls.push(call);
    const ok = (data) => ({ status: 0, stdout: typeof data === "string" ? data : JSON.stringify(data), stderr: "" });
    if (!this.installed) return { status: null, stdout: "", stderr: "spawn gh ENOENT", missing: true };
    if (args[0] === "--version") return ok("gh version 2.98.0 (2026-08-20)\n");
    if (args[0] === "auth" && args[1] === "login") {
      this.loggedIn = true;
      this.scopes = ["repo", "read:org", "gist", "project"];
      return ok("");
    }
    if (args[0] === "auth" && args[1] === "refresh") {
      this.scopes.push(...args[args.indexOf("--scopes") + 1].split(","));
      return ok("");
    }
    if (args.join(" ") === "api --include user") {
      if (!this.loggedIn) return { status: 4, stdout: "", stderr: "To get started with GitHub CLI, please run: gh auth login" };
      return ok(`HTTP/2.0 200 OK\r\nX-Oauth-Scopes: ${this.scopes.join(", ")}\r\n\r\n{"login":"me"}`);
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const { query, variables } = JSON.parse(input);
      call.query = query;
      call.variables = variables;
      return ok({ data: this.graphql(query, variables) });
    }
    throw new Error(`FakeGitHub does not know: gh ${args.join(" ")}`);
  }

  boardNode(board) {
    return { id: board.id, number: board.number, title: board.title, url: board.url, closed: board.closed };
  }

  graphql(query, variables) {
    if (query.includes("repository(owner:")) {
      const nameWithOwner = `${variables.owner}/${variables.name}`;
      if (variables.owner !== "acme") return { repository: null };
      const repo = this.repo(nameWithOwner);
      return {
        repository: {
          id: repo.id, nameWithOwner, url: `https://github.com/${nameWithOwner}`,
          defaultBranchRef: { name: repo.defaultBranch },
          owner: { __typename: this.ownerType, login: "acme", id: "O_acme" },
          projectsV2: { nodes: this.boards.filter((b) => repo.linked.has(b.id)).map((b) => this.boardNode(b)) },
        },
      };
    }
    if (query.includes("repositoryOwner(login:")) {
      return { repositoryOwner: { projectsV2: { nodes: this.boards.map((b) => this.boardNode(b)) } } };
    }
    if (query.includes("node(id:")) {
      const board = this.board(variables.id);
      return { node: board ? { fields: { nodes: board.fields.map((f) => ({ ...f })) } } : null };
    }
    const input = variables.input;
    if (query.includes("createProjectV2(input")) {
      const board = this.addBoard({ title: input.title });
      board.ownerId = input.ownerId;
      const repo = [...this.repos.values()].find((r) => r.id === input.repositoryId);
      repo.linked.add(board.id);
      return { createProjectV2: { projectV2: this.boardNode(board) } };
    }
    if (query.includes("updateProjectV2Field")) {
      const field = this.boards.flatMap((b) => b.fields).find((f) => f.id === input.fieldId);
      const known = new Set(field.options.map((o) => o.id));
      field.options = input.singleSelectOptions.map((o) => {
        if (o.id && !known.has(o.id)) throw new Error(`unknown option id ${o.id}`);
        return { id: o.id ?? this.id("O"), name: o.name, color: o.color, description: o.description };
      });
      return { updateProjectV2Field: { clientMutationId: null } };
    }
    if (query.includes("createProjectV2Field")) {
      const board = this.board(input.projectId);
      const field = { id: this.id("F"), name: input.name, dataType: input.dataType };
      if (input.dataType === "SINGLE_SELECT") {
        field.options = input.singleSelectOptions.map((o) => ({ id: this.id("O"), ...o }));
      } else {
        field.configuration = input.iterationConfiguration;
      }
      board.fields.push(field);
      return { createProjectV2Field: { clientMutationId: null } };
    }
    if (query.includes("linkProjectV2ToRepository")) {
      [...this.repos.values()].find((r) => r.id === input.repositoryId).linked.add(input.projectId);
      return { linkProjectV2ToRepository: { clientMutationId: null } };
    }
    throw new Error(`FakeGitHub does not know this query: ${query.slice(0, 80)}`);
  }

  /** The io.github object the command line expects. */
  io() {
    return {
      gh: this.gh,
      run: (command, args) => {
        this.runs.push([command, ...args]);
        if (command === "brew" || command === "winget") this.installed = true;
        return 0;
      },
      has: (command) => this.programs.includes(command),
      platform: this.platform,
      today: () => new Date(2026, 8, 24, 10),
      timeZone: "Europe/Berlin",
    };
  }
}
