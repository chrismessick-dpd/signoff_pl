/* Signoff PL: reads the design reviews a project's Parts link to.

   For each tool in config.tools it lists the tool's data repo plus every repository of the
   owner whose name starts with the tool's prefix (review-ee-…), and reads projects/*.json in
   each. Only `meta` and the `summary` block are kept. Files whose blob sha hasn't changed since
   the last refresh aren't downloaded again.

   The map from project id to repository is rebuilt on every refresh, so a Part keeps working
   when its project moves out of the data repo into its own shared repo. If the same project
   is in both for a moment (the move was interrupted), the shared repo's copy wins.

   index: { at, entries: { 'tool:id': { tool, id, repo, path, sha, name, number, revision,
            stage, summary | null } }, errors: [{ tool, repo, message }], files: { 'owner/repo':
            { path: { sha, entry } } } } */
(function (S) {
  'use strict';

  function Reader(opts) {
    this.owner = opts.owner;
    this.branch = opts.branch || 'main';
    this.tools = opts.tools || [];
    this.token = opts.token;
    this.fetch = opts.fetch;
    this.account = new S.GitHubAccount(opts.token, opts.fetch);
  }

  Reader.prototype.store = function (repo) {
    return new S.GitHubStore({ owner: this.owner, repo: repo, branch: this.branch, dataPath: '', token: this.token }, this.fetch);
  };

  function keep(doc) {
    var m = doc.meta || {};
    return { id: doc.id, name: m.name || '', number: m.board || '', revision: m.revision || '', stage: m.stage || '',
      archived: !!m.archived, summary: doc.summary || null };
  }

  // Resolves a new index. `prev` (the last index) supplies the blob cache.
  Reader.prototype.refresh = function (prev) {
    var self = this, prevFiles = (prev && prev.files) || {};
    var index = { at: new Date().toISOString(), entries: {}, errors: [], files: {} };

    function readRepo(tool, repo) {
      var full = self.owner + '/' + repo, store = self.store(repo), cached = prevFiles[full] || {};
      return store.snapshot().then(function (snap) {
        var files = snap.entries.filter(function (e) {
          return e.type === 'blob' && /^projects\/[^/]+\.json$/.test(e.path);
        });
        index.files[full] = {};
        return Promise.all(files.map(function (e) {
          var hit = cached[e.path];
          var got = hit && hit.sha === e.sha ? Promise.resolve(hit.entry)
            : store.blob(e.sha).then(function (text) { return keep(JSON.parse(text)); });
          return got.then(function (entry) {
            index.files[full][e.path] = { sha: e.sha, entry: entry };
            var key = tool.id + ':' + entry.id, had = index.entries[key];
            // The data repo is read first, so a shared repo's copy replaces its stale twin.
            if (had && repo === tool.dataRepo && had.repo !== full) return;
            index.entries[key] = Object.assign({ tool: tool.id, repo: full, path: e.path, sha: e.sha }, entry);
          }).catch(function (err) {
            index.errors.push({ tool: tool.id, repo: full, message: e.path + ': ' + err.message });
          });
        }));
      }).catch(function (err) {
        // A tool with no data repo yet is fine; anything else is reported.
        if (err.status === 404 && repo === tool.dataRepo) return;
        index.errors.push({ tool: tool.id, repo: full, message: err.message });
      });
    }

    return Promise.all(this.tools.map(function (tool) {
      return self.account.listRepos(self.owner, tool.prefix).then(function (names) {
        var repos = [tool.dataRepo].concat(names.filter(function (n) { return n !== tool.dataRepo; }));
        return repos.reduce(function (chain, repo) { return chain.then(function () { return readRepo(tool, repo); }); }, Promise.resolve());
      }).catch(function (err) {
        index.errors.push({ tool: tool.id, repo: self.owner, message: 'Couldn’t list ' + tool.name + ' repositories: ' + err.message });
      });
    })).then(function () { return index; });
  };

  // Designs of one tool, for the link picker: newest first, archived last.
  function designs(index, toolId) {
    var e = (index && index.entries) || {};
    return Object.keys(e).map(function (k) { return e[k]; }).filter(function (d) { return d.tool === toolId; })
      .sort(function (a, b) {
        return (a.archived - b.archived) || ((b.summary && b.summary.at) || '').localeCompare((a.summary && a.summary.at) || '') || a.name.localeCompare(b.name);
      });
  }

  S.PLReader = Reader;
  S.plReader = { designs: designs };
})(window.Signoff = window.Signoff || {});
