// BlackScreen XML parser with intelligent masking for sensitive data
// Parses blackScreen.xml and applies enterprise-grade masking rules

export interface MaskedBlackScreenData {
  meta: {
    network: string;
    printedDate: string;
    printedTime: string;
    printerLabel: string;
    documentRef: string;
  };
  messageHeader: {
    fundsType: string;
    uploadFormat: string;
    fileExtension: string;
    fileFormat: string;
    encoding: string;
    currency: string;
    amount: string;
    date: string;
    time: string;
  };
  transactionCodes: Record<string, string>;
  serverInfo: Record<string, string>;
  farmAndUser: Record<string, string>;
  transactionIdentifiers: Record<string, string>;
  senderOrderingCustomer: Record<string, string>;
  uploadStatus: {
    ipsvrType: string;
    status: string;
    amount: string;
    currency: string;
    ipipVersion: string;
    progress: { percent: number; step: string }[];
    accessGranted: string;
  };
  licenseActivations: { id: string; text: string }[];
  hardwareVersions: Record<string, string>;
  certificateChain: {
    beginCertificate: string;
    certificateData: string;
    endCertificate: string;
  };
  completion: {
    accessStatus: string;
    progressCompleted: string;
    finalAccess: string;
  };
  footer: {
    endOfMessage: string;
    date: string;
    time: string;
  };
}

// Masking rules for sensitive fields
const MASK_RULES: Record<string, (value: string) => string> = {
  // Transaction codes: first 4 + last 4
  referenceNumber: (v) => maskMiddle(v, 4, 4),
  transactionCode: (v) => maskMiddle(v, 4, 4),
  clearingCode: (v) => maskMiddle(v, 4, 4),
  transferDataEncryptionCode: (v) => maskMiddle(v, 4, 4),
  uploadCode: (v) => maskMiddle(v, 4, 4),
  permitCode: (v) => maskMiddle(v, 4, 4),
  finalReleaseCode: (v) => maskMiddle(v, 4, 4),
  downloadingCode: (v) => maskMiddle(v, 6, 4),
  accessCode: (v) => maskAll(v),
  interbankingBlockingCode: (v) => maskMiddle(v, 4, 4),
  
  // Server info: partial reveal
  identityCode: (v) => maskMiddle(v, 6, 4),
  serverGlobalIP: (v) => maskIP(v),
  clientNumber: (v) => maskMiddle(v, 8, 4),
  permitArrivalMoneyNumber: (v) => maskMiddle(v, 4, 4),
  windowsTerminalServer: (v) => maskMiddle(v, 3, 2),
  logonServer: (v) => maskMiddle(v, 3, 2),
  loginDomain: (v) => maskMiddle(v, 4, 3),
  
  // Farm & user
  userName: (v) => maskMiddle(v, 2, 2),
  userID: (v) => maskMiddle(v, 2, 2),
  clearingHouseNumber: (v) => maskMiddle(v, 4, 4),
  
  // Transaction identifiers
  transactionID: (v) => maskMiddle(v, 4, 4),
  finalBlockingCode: (v) => maskMiddle(v, 4, 4),
  transferCode: (v) => maskMiddle(v, 4, 4),
  uniqueTransactionNumber: (v) => maskMiddle(v, 4, 4),
  imadNumber: (v) => maskMiddle(v, 3, 3),
  
  // Sender / bank account
  accountNumber: (v) => maskMiddle(v, 2, 4),
  ibanNumber: (v) => maskIBAN(v),
  companyRegNo: (v) => maskMiddle(v, 3, 3),
  commonAccountNumber: (v) => maskMiddle(v, 2, 4),
  
  // Certificate
  certificateData: (v) => maskCertificate(v),
};

function maskAll(value: string): string {
  if (!value || value.length <= 2) return '****';
  return '****';
}

function maskMiddle(value: string, keepStart: number, keepEnd: number): string {
  if (!value || value.length <= keepStart + keepEnd) return value;
  const start = value.slice(0, keepStart);
  const end = value.slice(-keepEnd);
  const masked = '*'.repeat(Math.min(value.length - keepStart - keepEnd, 12));
  return `${start}${masked}${end}`;
}

function maskIP(value: string): string {
  // Mask last octet of IPv4
  const parts = value.split('.');
  if (parts.length >= 4) {
    parts[parts.length - 1] = '***';
    return parts.join('.');
  }
  // CIDR notation
  if (value.includes('/')) {
    const [ip, cidr] = value.split('/');
    const ipParts = ip.split('.');
    if (ipParts.length >= 4) {
      ipParts[ipParts.length - 1] = '***';
      return `${ipParts.join('.')}/${cidr}`;
    }
  }
  return maskMiddle(value, 6, 2);
}

function maskIBAN(value: string): string {
  if (!value || value.length <= 8) return value;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function maskCertificate(value: string): string {
  const cleaned = value.replace(/\s+/g, '');
  if (cleaned.length <= 32) return cleaned;
  return `${cleaned.slice(0, 16)}...${cleaned.slice(-8)}`;
}

function applyMask(fieldName: string, value: string): string {
  const key = fieldName.toLowerCase().replace(/[^a-z]/g, '');
  const rule = Object.entries(MASK_RULES).find(([k]) => key.includes(k.toLowerCase()));
  if (rule) return rule[1](value);
  // Default: if looks like a code/number, mask middle; if text, keep visible
  if (/\d/.test(value) && value.length > 8) return maskMiddle(value, 4, 4);
  return value;
}

export function parseBlackScreenXml(xmlText: string): MaskedBlackScreenData | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'application/xml');
    const root = doc.querySelector('SwiftMessage');
    if (!root) return null;

    const getText = (selector: string, parent: Element = root!): string => {
      return parent.querySelector(selector)?.textContent?.trim() || '';
    };

    const getAllText = (parentSelector: string): Record<string, string> => {
      const parent = root!.querySelector(parentSelector);
      if (!parent) return {};
      const result: Record<string, string> = {};
      parent.querySelectorAll(':scope > *').forEach((child) => {
        const key = child.tagName;
        const raw = child.textContent?.trim() || '';
        result[key] = applyMask(key, raw);
      });
      return result;
    };

    const metaEl = root.querySelector('Meta');
    const msgHeaderEl = root.querySelector('MessageHeader');
    const uploadStatusEl = root.querySelector('UploadStatus');
    const completionEl = root.querySelector('Completion');
    const footerEl = root.querySelector('Footer');
    const certEl = root.querySelector('CertificateChain');

    const data: MaskedBlackScreenData = {
      meta: {
        network: getText('Network', metaEl!),
        printedDate: getText('PrintedDate', metaEl!),
        printedTime: getText('PrintedTime', metaEl!),
        printerLabel: getText('PrinterLabel', metaEl!),
        documentRef: applyMask('documentRef', getText('DocumentRef', metaEl!)),
      },
      messageHeader: {
        fundsType: getText('FundsType', msgHeaderEl!),
        uploadFormat: getText('UploadFormat', msgHeaderEl!),
        fileExtension: getText('FileExtension', msgHeaderEl!),
        fileFormat: getText('FileFormat', msgHeaderEl!),
        encoding: getText('Encoding', msgHeaderEl!),
        currency: getText('Currency', msgHeaderEl!),
        amount: getText('Amount', msgHeaderEl!),
        date: getText('Date', msgHeaderEl!),
        time: getText('Time', msgHeaderEl!),
      },
      transactionCodes: getAllText('TransactionCodes'),
      serverInfo: getAllText('ServerInfo'),
      farmAndUser: getAllText('FarmAndUser'),
      transactionIdentifiers: getAllText('TransactionIdentifiers'),
      senderOrderingCustomer: getAllText('SenderOrderingCustomer'),
      uploadStatus: {
        ipsvrType: getText('IPSVRType', uploadStatusEl!),
        status: getText('Status', uploadStatusEl!),
        amount: getText('Amount', uploadStatusEl!),
        currency: getText('Currency', uploadStatusEl!),
        ipipVersion: getText('IPIPVersion', uploadStatusEl!),
        progress: Array.from(uploadStatusEl?.querySelectorAll('Step') || []).map((step) => ({
          percent: parseInt(step.getAttribute('percent') || '0'),
          step: step.textContent?.trim() || '',
        })),
        accessGranted: getText('AccessGranted', uploadStatusEl!),
      },
      licenseActivations: Array.from(root.querySelectorAll('LicenseActivations > License')).map((lic) => ({
        id: lic.getAttribute('id') || '',
        text: lic.textContent?.trim() || '',
      })),
      hardwareVersions: getAllText('HardwareVersions'),
      certificateChain: {
        beginCertificate: getText('BeginCertificate', certEl!),
        certificateData: applyMask('certificateData', getText('CertificateData', certEl!)),
        endCertificate: getText('EndCertificate', certEl!),
      },
      completion: {
        accessStatus: getText('AccessStatus', completionEl!),
        progressCompleted: getText('ProgressCompleted', completionEl!),
        finalAccess: getText('FinalAccess', completionEl!),
      },
      footer: {
        endOfMessage: getText('EndOfMessage', footerEl!),
        date: getText('Date', footerEl!),
        time: getText('Time', footerEl!),
      },
    };

    return data;
  } catch {
    return null;
  }
}

// Fallback hardcoded masked data when XML is unavailable
export function getFallbackMaskedData(): MaskedBlackScreenData {
  return {
    meta: {
      network: 'SWIFT NET',
      printedDate: '02/07/2026',
      printedTime: '10:05:36',
      printerLabel: 'PRINTER TEST-01',
      documentRef: '000****SRT-NR-205-TEST COPY',
    },
    messageHeader: {
      fundsType: 'M1 FUNDS',
      uploadFormat: 'S2S UPLOAD FORMAT',
      fileExtension: 'AES',
      fileFormat: 'FIN',
      encoding: 'UTF-8',
      currency: 'EUR (EURO)',
      amount: '500,000,000.00',
      date: '02/07/2026',
      time: '10:05:36',
    },
    transactionCodes: {
      ReferenceNumber: 'DEUT****9318****72',
      TransactionCode: '144A:S:G4639DVY8',
      ClearingCode: 'DE84****6382****61',
      TransferDataEncryptionCode: 'DE90****3491****19',
      UploadCode: 'DE67****9712****89',
      PermitCode: 'DE98****1234****23',
      FinalReleaseCode: '****91756',
      DownloadingCode: 'AM-83****92-1****1',
      AccessCode: '****',
      InterbankingBlockingCode: 'DE90****7891****90',
    },
    serverInfo: {
      IdentityCode: '31A-DB****21ZXF',
      ServerGlobalIDOrigin: 'AS7418',
      ServerGlobalIP: '193.150.166.***/24',
      ClientNumber: '000000****FGN582****9873',
      PermitArrivalMoneyNumber: 'DE567****5678****90',
      WindowsTerminalServer: 'S02****4',
      LoginDomain: 'DEUT****604',
      LogonServer: '587****9',
    },
    farmAndUser: {
      FarmName: 'FARM 18',
      UserName: '58****8',
      UserID: 'FG****2',
      ClearingHouseNumber: 'DE58****5610****29',
    },
    transactionIdentifiers: {
      TransactionID: 'DE87****2837****28',
      FinalBlockingCode: '****91756',
      TransferCode: 'DE76****3456****23',
      UniqueTransactionNumber: 'DE99****1827****01',
      IMADNumber: '384****82',
    },
    senderOrderingCustomer: {
      BankName: 'DEUTSCHE BANK AG',
      BankAddress: 'TAUNUSANLAGE 12, 60325 FRANKFURT AM MAIN, GERMANY',
      AccountName: 'EURO TRADE HOLDINGS (SEGREGATED ACCOUNT)',
      AccountNumber: '****67890',
      IBANNumber: 'DE44****67890',
    },
    uploadStatus: {
      ipsvrType: 'S2S UPLOAD ACCESS',
      status: 'UPLOAD MESSAGE - UPLOAD SUCCESSFUL',
      amount: '500,000,000.00',
      currency: 'EUR (EURO)',
      ipipVersion: 'IPV4/IPV6',
      progress: [
        { percent: 10, step: 'SVR1' },
        { percent: 40, step: 'SVR2' },
        { percent: 80, step: 'SVR3' },
        { percent: 100, step: 'SVR4' },
      ],
      accessGranted: 'true',
    },
    licenseActivations: [
      { id: '1', text: 'LANG4XGEPAY01 - active port-basic slot activated' },
      { id: '2', text: 'LANG8GEPAYG01 - active port-basic slot activated' },
      { id: '3', text: 'LANG2XGEPAY01 - active port-basic slot activated' },
    ],
    hardwareVersions: {
      PCBVersion: '548293847 REV B',
      EPLDVersion: 'V135',
      FPGAVersion: 'V141',
      INFOVersion: '58192746 REV E',
    },
    certificateChain: {
      beginCertificate: 'BEGIN CERTIFICATE',
      certificateData: 'adfby4x7n841y18...aff',
      endCertificate: 'END CERTIFICATE',
    },
    completion: {
      accessStatus: 'ALL ACCESS HAS BEEN GRANTED',
      progressCompleted: '100%',
      finalAccess: 'ACCESS GRANTED',
    },
    footer: {
      endOfMessage: 'END OF MESSAGE',
      date: '02/07/2026',
      time: '10:05:36',
    },
  };
}
