// @ts-check
/**
 * The three managed solutions, in the order they're imported, and what each one needs: its
 * environment variables, its Dataverse connection reference and the flows it brings.
 *
 * The flow and solution IDs below are the solutions' own component IDs. They're the same in every
 * tenant the solutions are imported into.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { solutionInfo } from './zip.js';

export const DATAVERSE_CONNECTOR = 'shared_commondataserviceforapps';
export const DATAVERSE_CONNECTOR_ID = `/providers/Microsoft.PowerApps/apis/${DATAVERSE_CONNECTOR}`;
/** The value the solutions were exported with in their secret variables. */
export const PLACEHOLDER_SECRET = 'insertsecrethere';

/**
 * @typedef {'audit' | 'sweep'} AppKey  Which app registration a solution signs in as.
 *
 * @typedef {object} FlowDef
 * @property {string} id  The workflow ID.
 * @property {string} name
 * @property {'scheduled' | 'manual'} kind
 * @property {boolean} [runNow]  Run it once after it's turned on, so the first data lands today.
 *
 * @typedef {object} VarNames
 * @property {string} tenant
 * @property {string} appId
 * @property {string} secret
 * @property {string} usingAkv
 * @property {string} keyVault
 *
 * @typedef {object} SolutionDef
 * @property {string} key
 * @property {string} uniqueName
 * @property {string} file
 * @property {string} version  What the zip in solution\ holds. A test keeps them in step.
 * @property {string} lane
 * @property {string} title
 * @property {AppKey} app
 * @property {VarNames} vars
 * @property {string[]} connectionReferences  Bound to the Dataverse connection.
 * @property {FlowDef[]} flows
 * @property {boolean} holdsData  Removing it deletes tables and their rows.
 */

/** @type {SolutionDef[]} */
export const SOLUTIONS = [
  {
    key: 'sharepoint',
    uniqueName: 'SharePointAgentLogging',
    file: 'SharePointAgentLogging_managed.zip',
    version: '1.0.0.0',
    lane: 'E',
    title: 'SharePoint agent logging',
    app: 'audit',
    vars: { tenant: 'poc_SP_Tenant', appId: 'poc_SP_AppRegID', secret: 'poc_SP_Secret', usingAkv: 'poc_SP_UsingAKVtruefalse', keyVault: 'poc_SP_KeyVaultSecret' },
    connectionReferences: ['poc_sharedcommondataserviceforapps_spagent'],
    flows: [
      { id: '9f0d8598-22ab-4b27-8a8a-8b1a2f4593c1', name: 'SharePoint agent inventory (daily)', kind: 'scheduled', runNow: true },
      { id: '4d5bca93-3fb2-49ef-90d6-a2f7c4e861b0', name: 'SharePoint agent inventory (manual)', kind: 'manual' },
    ],
    holdsData: true,
  },
  {
    key: 'appusers',
    uniqueName: 'AgentAppUserProvisioning',
    file: 'AgentAppUserProvisioning_managed.zip',
    version: '1.0.6.0',
    lane: 'D',
    title: 'Agent app user provisioning',
    app: 'sweep',
    vars: { tenant: 'poc_AU_Tenant', appId: 'poc_AU_AppRegID', secret: 'poc_AU_Secret', usingAkv: 'poc_AU_UsingAKVtruefalse', keyVault: 'poc_AU_KeyVaultSecret' },
    // The solution also carries two web-contents references the flow doesn't use; they're left unbound.
    connectionReferences: ['poc_sharedcommondataserviceforapps_appusr'],
    flows: [{ id: '3f9c1a54-6b2e-4d81-9f37-2c5a8e41b7d0', name: 'App users: grant sweep application users across environments (weekly)', kind: 'scheduled' }],
    holdsData: false,
  },
  {
    key: 'sweep',
    uniqueName: 'AgentKnowledgeSourceSweep',
    file: 'AgentKnowledgeSourceSweep_managed.zip',
    version: '1.0.4.0',
    lane: 'D',
    title: 'Agent knowledge source sweep',
    app: 'sweep',
    vars: { tenant: 'poc_KS_Tenant', appId: 'poc_KS_AppRegID', secret: 'poc_KS_Secret', usingAkv: 'poc_KS_UsingAKVtruefalse', keyVault: 'poc_KS_KeyVaultSecret' },
    connectionReferences: ['poc_sharedcommondataserviceforapps_ksweep'],
    flows: [{ id: '7ad41f38-9c02-4bd6-8e35-1c4a2f6db310', name: 'Knowledge sources sweep (daily)', kind: 'scheduled', runNow: true }],
    holdsData: false,
  },
];

/** @param {string} key */
export function solution(key) {
  const s = SOLUTIONS.find((x) => x.key === key);
  if (!s) throw new Error(`No solution called ${key}.`);
  return s;
}

/** The app-user grant flow: imported in what-if mode, made real only after a separate approval. */
export const GRANT_FLOW_ID = solution('appusers').flows[0].id;

/**
 * @typedef {object} EnvInputs
 * @property {string} tenantId
 * @property {{ audit?: string, sweep?: string }} appIds
 * @property {'envvar' | 'keyvault'} secretMode
 * @property {{ audit?: string, sweep?: string }} [secrets]  A fresh client secret, when one was just made. Never saved.
 * @property {{ audit?: string, sweep?: string }} [keyVaultRefs]  Key Vault secret references, in Key Vault mode.
 * @property {'Agents' | 'Dataverse'} [scopeMode]
 * @property {boolean} [whatIf]
 * @property {number} [maxGrants]
 * @property {boolean} [reassertAll]
 *
 * @typedef {{ schemaname: string, value: string, secret?: boolean }} EnvValue
 */

/**
 * The environment variable values a solution needs. Packaged defaults (authority, audience,
 * look-back windows, page size, polling) are left as shipped. A secret is only included when a fresh
 * one was just made: the installer never has the old one.
 * @param {SolutionDef} def
 * @param {EnvInputs} inputs
 * @returns {EnvValue[]}
 */
export function envVarValues(def, inputs) {
  const appId = inputs.appIds[def.app];
  if (!appId) throw new Error(`${def.title} needs the ${def.app === 'audit' ? 'audit collector' : 'knowledge sweep'} app registration first.`);
  /** @type {EnvValue[]} */
  const values = [
    { schemaname: def.vars.tenant, value: inputs.tenantId },
    { schemaname: def.vars.appId, value: appId },
    { schemaname: def.vars.usingAkv, value: inputs.secretMode === 'keyvault' ? 'true' : 'false' },
  ];
  if (inputs.secretMode === 'keyvault') {
    const ref = inputs.keyVaultRefs?.[def.app];
    if (ref) values.push({ schemaname: def.vars.keyVault, value: ref });
  } else {
    const secret = inputs.secrets?.[def.app];
    if (secret) values.push({ schemaname: def.vars.secret, value: secret, secret: true });
  }
  if (def.key === 'appusers') {
    values.push(
      { schemaname: 'poc_AU_ScopeMode', value: inputs.scopeMode ?? 'Agents' },
      { schemaname: 'poc_AU_WhatIf', value: inputs.whatIf === false ? 'false' : 'true' },
      { schemaname: 'poc_AU_MaxGrants', value: String(inputs.maxGrants ?? 25) },
      { schemaname: 'poc_AU_ReassertAll', value: inputs.reassertAll === false ? 'false' : 'true' },
    );
  }
  return values;
}

/**
 * The ComponentParameters an import takes: the connection references bound to the Dataverse
 * connection, and the environment variable values.
 * @param {SolutionDef} def
 * @param {EnvValue[]} values
 * @param {string | undefined} connectionId
 */
export function componentParameters(def, values, connectionId) {
  return [
    ...(connectionId
      ? def.connectionReferences.map((name) => ({
        '@odata.type': 'Microsoft.Dynamics.CRM.connectionreference',
        connectionreferencelogicalname: name,
        connectionid: connectionId,
        connectorid: DATAVERSE_CONNECTOR_ID,
      }))
      : []),
    ...values.map((v) => ({
      '@odata.type': 'Microsoft.Dynamics.CRM.environmentvariablevalue',
      schemaname: v.schemaname,
      value: v.value,
    })),
  ];
}

/** Where the solution zips are: the repo's solution folder, next to the installer. */
export const solutionPath = (/** @type {string} */ dir, /** @type {SolutionDef} */ def) => join(dir, def.file);

/**
 * Reads a solution zip and checks it's the one expected.
 * @param {string} dir
 * @param {SolutionDef} def
 * @param {(path: string) => Buffer} [read]
 */
export function loadSolutionZip(dir, def, read = (p) => readFileSync(p)) {
  const bytes = read(solutionPath(dir, def));
  const info = solutionInfo(bytes);
  if (info.uniqueName !== def.uniqueName) throw new Error(`${def.file} holds ${info.uniqueName}, not ${def.uniqueName}.`);
  return { bytes, ...info };
}
