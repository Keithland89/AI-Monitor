// Builds the M365UsageReports solution: one daily flow that saves five Microsoft Graph usage reports
// into poc_m365usagereports, the table the app's Work patterns view reads.
//
//   node solution/work-patterns/build.mjs
//
// Writes solution/M365UsageReports_managed.zip (what the installer imports) and the unmanaged
// M365UsageReports.zip. The table itself isn't in the solution: the installer creates it first, the
// same way it creates the knowledge sweep's tables, so the solution lists it as a missing dependency.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..');

export const UNIQUE_NAME = 'M365UsageReports';
export const VERSION = '1.0.0.0';
export const FLOW_ID = 'b6e2a0d4-5c3f-4e1a-9d87-2f4b6c8e0a13';
const FLOW_NAME = 'WorkPatterns | Microsoft 365 usage reports to Dataverse (v1)';
const FLOW_DESC = 'Daily copy of five Microsoft 365 usage reports from Microsoft Graph into poc_m365usagereports, one row per report, for the Work patterns view.';
const CONN_REF = 'poc_sharedcommondataserviceforapps_m365use';
const TABLE = 'poc_m365usagereports';
const PERIOD = 'D30';

// The names must match M365_REPORTS in app/src/data/m365.ts.
export const REPORTS = [
  ['getOffice365ServicesUserCounts', 'reports'],
  ['getM365AppUserCounts', 'reports'],
  ['getEmailActivityCounts', 'reports'],
  ['getTeamsUserActivityCounts', 'reports'],
  ['getMicrosoft365CopilotUserCountSummary', 'copilot/reports'],
].map(([name, path]) => ({ name, url: `https://graph.microsoft.com/beta/${path}/${name}(period='${PERIOD}')?$format=application/json` }));

const VARS = [
  ['Tenant', 'inserttenantidhere', '00000000-0000-0000-0000-000000000000', 'Directory (tenant) id the app registration lives in'],
  ['AppRegID', 'insertappidhere', '00000000-0000-0000-0000-000000000000', 'Application (client) id of the audit app registration'],
  ['Authority', 'https://login.microsoftonline.com', 'https://login.microsoftonline.com', 'Token authority - change for a sovereign cloud'],
  ['Secret', 'insertsecrethere', '', 'Client secret, used when WP_UsingAKVtruefalse is false'],
  ['UsingAKVtruefalse', 'false', 'false', 'true to read the secret from Key Vault instead'],
  ['KeyVaultSecret', 'insertsecrethere', '', 'Key Vault secret reference, used when WP_UsingAKVtruefalse is true'],
];
const p = (v) => `parameters('WP_${v} (poc_WP_${v})')`;

/** A stable id per action, so rebuilding doesn't churn the flow. */
const opId = (name) => {
  const h = createHash('sha1').update(`${UNIQUE_NAME}/${name}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const meta = (name) => ({ operationMetadataId: opId(name) });
const dataverse = (operationId, parameters) => ({
  parameters,
  host: { apiId: '/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps', connectionName: 'shared_commondataserviceforapps-1', operationId },
});
const placeholderCheck = (expr, placeholder) => [
  { equals: [`@empty(trim(coalesce(${expr}, '')))`, true] },
  { equals: [`@toLower(trim(coalesce(${expr}, '')))`, placeholder] },
];
const terminate = (name, code, message) => ({ [name]: { runAfter: {}, metadata: meta(name), type: 'Terminate', inputs: { runStatus: 'Failed', runError: { code, message } } } });

export function flowDefinition() {
  const parameters = {
    $authentication: { defaultValue: {}, type: 'SecureObject' },
    $connections: { defaultValue: {}, type: 'Object' },
  };
  for (const [v, , def, description] of VARS) {
    parameters[`WP_${v} (poc_WP_${v})`] = { defaultValue: def, type: 'String', metadata: { schemaName: `poc_WP_${v}`, description } };
  }

  const item = "items('For_each_report')";
  const fields = {
    'item/poc_name': `@${item}?['name']`,
    'item/poc_period': PERIOD,
    'item/poc_payload': "@{string(coalesce(body('Get_Report'), actions('Get_Report')?['error'], ''))}",
    'item/poc_status': "@{coalesce(outputs('Get_Report')?['statusCode'], 'error')}",
    'item/poc_collectedat': "@outputs('RunStartedAt')",
  };

  const actions = {
    RunStartedAt: { runAfter: {}, metadata: meta('RunStartedAt'), type: 'Compose', inputs: '@utcNow()' },
    varFailed: { runAfter: { RunStartedAt: ['Succeeded'] }, metadata: meta('varFailed'), type: 'InitializeVariable', inputs: { variables: [{ name: 'varFailed', type: 'integer', value: 0 }] } },
    theSecret: { runAfter: { varFailed: ['Succeeded'] }, metadata: meta('theSecret'), type: 'InitializeVariable', inputs: { variables: [{ name: 'theSecret', type: 'string', value: '' }] } },
    Resolve_Secret: {
      runAfter: { theSecret: ['Succeeded'] },
      metadata: meta('Resolve_Secret'),
      type: 'If',
      expression: { equals: [`@toLower(${p('UsingAKVtruefalse')})`, 'true'] },
      actions: { Set_Secret_From_KeyVault: { runAfter: {}, metadata: meta('Set_Secret_From_KeyVault'), type: 'SetVariable', inputs: { name: 'theSecret', value: `@${p('KeyVaultSecret')}` } } },
      else: { actions: { Set_Secret_From_EnvironmentVariable: { runAfter: {}, metadata: meta('Set_Secret_From_EnvironmentVariable'), type: 'SetVariable', inputs: { name: 'theSecret', value: `@${p('Secret')}` } } } },
    },
    Fail_If_No_Secret: {
      runAfter: { Resolve_Secret: ['Succeeded'] },
      metadata: meta('Fail_If_No_Secret'),
      type: 'If',
      expression: { or: placeholderCheck("variables('theSecret')", 'insertsecrethere') },
      actions: terminate('Terminate_No_Secret', 'NoSecret', 'Neither poc_WP_Secret nor poc_WP_KeyVaultSecret holds a real value - one of them is still the shipped insertsecrethere placeholder. Set the correct one before enabling the flow.'),
      else: { actions: {} },
    },
    Fail_If_Not_Configured: {
      runAfter: { Fail_If_No_Secret: ['Succeeded'] },
      metadata: meta('Fail_If_Not_Configured'),
      type: 'If',
      expression: { or: [...placeholderCheck(p('AppRegID'), 'insertappidhere'), ...placeholderCheck(p('Tenant'), 'inserttenantidhere')] },
      actions: terminate('Terminate_Not_Configured', 'NotConfigured', 'poc_WP_AppRegID or poc_WP_Tenant is empty or still holds its shipped placeholder. Set both to the audit app registration before enabling the flow.'),
      else: { actions: {} },
    },
    Reports: { runAfter: { Fail_If_Not_Configured: ['Succeeded'] }, metadata: meta('Reports'), type: 'Compose', inputs: REPORTS },
    For_each_report: {
      foreach: "@outputs('Reports')",
      runAfter: { Reports: ['Succeeded'] },
      metadata: meta('For_each_report'),
      type: 'Foreach',
      runtimeConfiguration: { concurrency: { repetitions: 1 } },
      actions: {
        Get_Report: {
          runAfter: {},
          metadata: meta('Get_Report'),
          type: 'Http',
          inputs: {
            method: 'GET',
            uri: `@${item}?['url']`,
            headers: { Accept: 'application/json' },
            authentication: {
              type: 'ActiveDirectoryOAuth',
              tenant: `@${p('Tenant')}`,
              audience: 'https://graph.microsoft.com',
              authority: `@${p('Authority')}`,
              clientId: `@${p('AppRegID')}`,
              secret: "@variables('theSecret')",
            },
            retryPolicy: { type: 'exponential', count: 4, interval: 'PT10S', maximumInterval: 'PT2M' },
          },
          limit: { timeout: 'PT3M' },
          operationOptions: 'DisableAsyncPattern',
        },
        Count_Failure: {
          runAfter: { Get_Report: ['Succeeded', 'Failed', 'TimedOut'] },
          metadata: meta('Count_Failure'),
          type: 'If',
          expression: { not: { equals: ["@actions('Get_Report')?['status']", 'Succeeded'] } },
          actions: { Increment_Failed: { runAfter: {}, metadata: meta('Increment_Failed'), type: 'IncrementVariable', inputs: { name: 'varFailed', value: 1 } } },
          else: { actions: {} },
        },
        Find_Row: {
          runAfter: { Count_Failure: ['Succeeded'] },
          metadata: meta('Find_Row'),
          type: 'OpenApiConnection',
          inputs: dataverse('ListRecords', { entityName: TABLE, $select: 'poc_m365usagereportid', $filter: `@{concat('poc_name eq ''', ${item}?['name'], '''')}`, $top: 1 }),
        },
        Row_Exists: {
          runAfter: { Find_Row: ['Succeeded'] },
          metadata: meta('Row_Exists'),
          type: 'If',
          expression: { greater: ["@length(coalesce(outputs('Find_Row')?['body/value'], json('[]')))", 0] },
          actions: {
            Update_Report: {
              runAfter: {},
              metadata: meta('Update_Report'),
              type: 'OpenApiConnection',
              inputs: dataverse('UpdateRecord', { entityName: TABLE, recordId: "@first(outputs('Find_Row')?['body/value'])?['poc_m365usagereportid']", ...fields }),
            },
          },
          else: {
            actions: {
              Create_Report: { runAfter: {}, metadata: meta('Create_Report'), type: 'OpenApiConnection', inputs: dataverse('CreateRecord', { entityName: TABLE, ...fields }) },
            },
          },
        },
      },
    },
    Fail_If_Any_Report_Failed: {
      runAfter: { For_each_report: ['Succeeded', 'Failed'] },
      metadata: meta('Fail_If_Any_Report_Failed'),
      type: 'If',
      expression: { greater: ["@variables('varFailed')", 0] },
      actions: terminate(
        'Terminate_Reports_Failed',
        'ReportsFailed',
        "@{concat(string(variables('varFailed')), ' of ', string(length(outputs('Reports'))), ' Microsoft 365 usage reports could not be read. The audit app registration needs the Reports.Read.All application permission with admin consent. The failed rows in poc_m365usagereports hold the Graph error.')}",
      ),
      else: { actions: {} },
    },
  };

  return {
    properties: {
      connectionReferences: {
        'shared_commondataserviceforapps-1': { api: { name: 'shared_commondataserviceforapps' }, connection: { connectionReferenceLogicalName: CONN_REF }, runtimeSource: 'embedded' },
      },
      definition: {
        $schema: 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#',
        contentVersion: '1.0.0.0',
        parameters,
        triggers: {
          Recurrence: {
            recurrence: { frequency: 'Day', interval: 1, timeZone: 'GMT Standard Time', schedule: {} },
            metadata: meta('Recurrence'),
            type: 'Recurrence',
          },
        },
        actions,
      },
      templateName: null,
    },
    schemaVersion: '1.0.0.0',
  };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nils = (tags) => tags.map((t) => `          <${t} xsi:nil="true"></${t}>`).join('\n');
const nilAddress = (n) => `        <Address>
          <AddressNumber>${n}</AddressNumber>
          <AddressTypeCode>1</AddressTypeCode>
${nils(['City', 'County', 'Country', 'Fax', 'FreightTermsCode', 'ImportSequenceNumber', 'Latitude', 'Line1', 'Line2', 'Line3', 'Longitude', 'Name', 'PostalCode', 'PostOfficeBox', 'PrimaryContactName'])}
          <ShippingMethodCode>1</ShippingMethodCode>
${nils(['StateOrProvince', 'Telephone1', 'Telephone2', 'Telephone3', 'TimeZoneRuleVersionNumber', 'UPSZone', 'UTCOffset', 'UTCConversionTimeZoneCode'])}
        </Address>`;

const ORG = 'OrganizationVersion="9.2.26084.131" OrganizationSchemaType="Standard" CRMServerServiceabilityVersion="9.2.26084.00135"';

function solutionXml(managed) {
  return `<ImportExportXml version="9.2.26084.131" SolutionPackageVersion="9.2" languagecode="1033" generatedBy="CrmLive" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${ORG}>
  <SolutionManifest>
    <UniqueName>${UNIQUE_NAME}</UniqueName>
    <LocalizedNames>
      <LocalizedName description="Microsoft 365 Usage Reports" languagecode="1033" />
    </LocalizedNames>
    <Descriptions>
      <Description description="Work patterns lane of Agent Monitor: a daily flow that copies five Microsoft 365 usage reports from Microsoft Graph into one Dataverse table." languagecode="1033" />
    </Descriptions>
    <Version>${VERSION}</Version>
    <Managed>${managed ? 1 : 0}</Managed>
    <Publisher>
      <UniqueName>ProofOfConcept</UniqueName>
      <LocalizedNames>
        <LocalizedName description="PoC" languagecode="1033" />
      </LocalizedNames>
      <Descriptions />
      <EMailAddress xsi:nil="true"></EMailAddress>
      <SupportingWebsiteUrl xsi:nil="true"></SupportingWebsiteUrl>
      <CustomizationPrefix>poc</CustomizationPrefix>
      <CustomizationOptionValuePrefix>89396</CustomizationOptionValuePrefix>
      <Addresses>
${nilAddress(1)}
${nilAddress(2)}
      </Addresses>
    </Publisher>
    <RootComponents>
      <RootComponent type="29" id="{${FLOW_ID}}" behavior="0" />
    </RootComponents>
    <MissingDependencies>
      <MissingDependency>
        <Required type="1" schemaName="poc_m365usagereport" displayName="Microsoft 365 usage report" solution="Active" />
        <Dependent type="29" displayName="${esc(FLOW_NAME)}" id="{${FLOW_ID}}" />
      </MissingDependency>
    </MissingDependencies>
  </SolutionManifest>
</ImportExportXml>`;
}

const flowFile = () => `${FLOW_NAME.replace(/[^A-Za-z0-9]/g, '').slice(0, 50)}-${FLOW_ID.toUpperCase()}.json`;

function customizationsXml() {
  return `<ImportExportXml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ${ORG}>
  <Entities></Entities>
  <Roles></Roles>
  <Workflows>
    <Workflow WorkflowId="{${FLOW_ID}}" Name="${esc(FLOW_NAME)}" Description="${esc(FLOW_DESC)}">
      <JsonFileName>/Workflows/${flowFile()}</JsonFileName>
      <Type>1</Type>
      <Subprocess>0</Subprocess>
      <Category>5</Category>
      <Mode>0</Mode>
      <Scope>4</Scope>
      <OnDemand>0</OnDemand>
      <TriggerOnCreate>0</TriggerOnCreate>
      <TriggerOnDelete>0</TriggerOnDelete>
      <AsyncAutodelete>0</AsyncAutodelete>
      <SyncWorkflowLogOnFailure>0</SyncWorkflowLogOnFailure>
      <StateCode>1</StateCode>
      <StatusCode>2</StatusCode>
      <RunAs>1</RunAs>
      <IsTransacted>1</IsTransacted>
      <IntroducedVersion>1.0</IntroducedVersion>
      <IsCustomizable>1</IsCustomizable>
      <IsCustomProcessingStepAllowedForOtherPublishers>1</IsCustomProcessingStepAllowedForOtherPublishers>
      <ModernFlowType>0</ModernFlowType>
      <PrimaryEntity>none</PrimaryEntity>
      <LocalizedNames>
        <LocalizedName languagecode="1033" description="${esc(FLOW_NAME)}" />
      </LocalizedNames>
      <Descriptions>
        <Description languagecode="1033" description="${esc(FLOW_DESC)}" />
      </Descriptions>
    </Workflow>
  </Workflows>
  <FieldSecurityProfiles></FieldSecurityProfiles>
  <Templates />
  <EntityMaps />
  <EntityRelationships />
  <OrganizationSettings />
  <optionsets />
  <CustomControls />
  <EntityDataProviders />
  <connectionreferences>
    <connectionreference connectionreferencelogicalname="${CONN_REF}">
      <connectionreferencedisplayname>Microsoft Dataverse ${UNIQUE_NAME}</connectionreferencedisplayname>
      <connectorid>/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps</connectorid>
      <iscustomizable>1</iscustomizable>
      <promptingbehavior>0</promptingbehavior>
      <statecode>0</statecode>
      <statuscode>1</statuscode>
    </connectionreference>
  </connectionreferences>
  <Languages>
    <Language>1033</Language>
  </Languages>
</ImportExportXml>`;
}

function envVarXml([v, def, , description]) {
  return `<environmentvariabledefinition schemaname="poc_WP_${v}">
  <defaultvalue>${esc(def)}</defaultvalue>
  <description default="${esc(description)}">
    <label description="${esc(description)}" languagecode="1033" />
  </description>
  <displayname default="WP_${v}">
    <label description="WP_${v}" languagecode="1033" />
  </displayname>
  <introducedversion>1.0.0.0</introducedversion>
  <iscustomizable>1</iscustomizable>
  <isrequired>0</isrequired>
  <secretstore>0</secretstore>
  <type>100000000</type>
</environmentvariabledefinition>`;
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/octet-stream" /><Default Extension="json" ContentType="application/octet-stream" /></Types>';

/** @param {boolean} managed */
export function entries(managed) {
  return [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['customizations.xml', customizationsXml()],
    ['solution.xml', solutionXml(managed)],
    ...VARS.map((v) => [`environmentvariabledefinitions/poc_WP_${v[0]}/environmentvariabledefinition.xml`, envVarXml(v)]),
    [`Workflows/${flowFile()}`, JSON.stringify(flowDefinition(), null, 2)],
  ];
}

/** A plain deflate zip with a fixed timestamp, so the same source always builds the same bytes. */
export function zip(files) {
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (11 << 5) | 1;
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.from(text, 'utf8');
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(data.length, 18);
    head.writeUInt32LE(raw.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    locals.push(head, nameBuf, data);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + data.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dirBuf, end]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(join(OUT, `${UNIQUE_NAME}_managed.zip`), zip(entries(true)));
  writeFileSync(join(OUT, `${UNIQUE_NAME}.zip`), zip(entries(false)));
  console.log(`Wrote ${UNIQUE_NAME}_managed.zip and ${UNIQUE_NAME}.zip (${VERSION}).`);
}
