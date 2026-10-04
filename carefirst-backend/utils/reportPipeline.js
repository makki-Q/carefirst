// Automatic report summary (decision 9 in PROJECT_GUIDE.md): after a lab uploads a report,
// read it (Document Intelligence), compare each result with the printed normal range,
// and give the patient an English + Urdu summary that tells them to see their doctor.
// Runs in the background; a lab-written summary is never overwritten.
const path = require('path');
const TestReport   = require('../models/TestReport');
const Notification = require('../models/Notification');
const { sendNotification } = require('../socket/notificationSocket');
const { readReport, docIntelConfigured } = require('./reportReader');
const { interpretReport } = require('./reportInterpreter');
const { summarizeReport } = require('./reportSummary');

const UPLOADS = path.join(__dirname, '..', 'uploads');

// "http://host/uploads/reports/abc.pdf" → <backend>/uploads/reports/abc.pdf
const localFile = (url) => {
  const m = String(url || '').match(/\/uploads\/(reports\/[^/?#]+)$/);
  return m ? path.join(UPLOADS, m[1]) : null;
};

const processReport = async (reportId) => {
  const report = await TestReport.findById(reportId);
  if (!report) return null;
  if (!docIntelConfigured()) {
    report.autoRead = { status: 'skipped', error: 'not_configured' };
    await report.save();
    return report;
  }

  report.autoRead = { status: 'processing' };
  await report.save();

  try {
    const file = localFile(report.reportUrl);
    if (!file) throw Object.assign(new Error('Report file not found'), { code: 'no_file' });
    const analysis = await readReport(file);
    const { kind, findings } = interpretReport(analysis);
    const { en, ur } = summarizeReport({ kind, findings });

    report.autoRead = {
      status: 'ready', kind, findings,
      pages: analysis.pages, totalPages: analysis.totalPages, readAt: new Date(),
    };
    const labWroteIt = report.summarySource === 'lab' || (report.summary && report.summarySource !== 'auto');
    if (!labWroteIt) {
      report.summary           = en;
      report.summaryUrdu       = ur;
      report.summaryUrduSource = 'auto';
      report.summarySource     = 'auto';
    }
    await report.save();

    const flagged = findings.filter(f => ['high', 'low', 'abnormal'].includes(f.status)).length;
    const message =
      kind === 'table' && flagged ? `${flagged} result${flagged === 1 ? ' is' : 's are'} outside the normal range. Please share the report with your doctor and visit them.`
      : kind === 'table' ? 'Your results are within the normal range printed on the report. Please still share it with your doctor.'
      : 'Please take this report to your doctor and visit them.';
    const notif = await Notification.create({
      recipient: report.patient,
      title:     `${report.testName} Summary Ready`,
      message:   `${message} You can read and listen to the summary in Urdu in My Reports.`,
      type:      'report_summary_ready',
      meta:      { reportId: report._id, flagged },
    });
    sendNotification(report.patient.toString(), notif);
  } catch (err) {
    console.error(`[ReportReader] ${report._id}: ${err.message}`);
    report.autoRead = { status: 'failed', error: err.code || 'error' };
    await report.save();
  }
  return report;
};

// Fire and forget — the upload request doesn't wait for the reading
const processReportInBackground = (reportId) => {
  setImmediate(() => processReport(reportId).catch(err => console.error(`[ReportReader] ${err.message}`)));
};

module.exports = { processReport, processReportInBackground };
