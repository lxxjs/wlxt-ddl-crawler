/**
 * Export homework as plain text or .ics (VTODO) for Apple Reminders.
 */

/**
 * Generate a plain text list of homework for clipboard.
 */
function generateTextList(homeworkList) {
  if (!homeworkList.length) return '没有作业';

  return homeworkList.map(hw => {
    const deadline = hw.deadlineStr || '无截止日期';
    const timeLeft = hw.timeLeft ? ` (${hw.timeLeft})` : '';
    return `[${hw.courseName}] ${hw.title} — ${deadline}${timeLeft}`;
  }).join('\n');
}

/**
 * Generate an ICS file string with VTODO entries.
 */
function generateICS(homeworkList) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//wlxt-ddl-crawler//Homework Reminder//CN',
    'X-WR-CALNAME:网络学堂作业',
  ];

  for (const hw of homeworkList) {
    // Skip expired items
    if (hw.urgency === 0) continue;

    lines.push('BEGIN:VTODO');
    lines.push(`UID:${hw.id}@wlxt-ddl-crawler`);
    lines.push(`SUMMARY:[${hw.courseName}] ${escapeICS(hw.title)}`);

    if (hw.deadline) {
      const d = new Date(hw.deadline);
      lines.push(`DUE:${formatICSDate(d)}`);
      // Set alarm 1 hour before deadline
      lines.push('BEGIN:VALARM');
      lines.push('ACTION:DISPLAY');
      lines.push(`DESCRIPTION:作业即将截止: ${escapeICS(hw.title)}`);
      lines.push('TRIGGER:-PT1H');
      lines.push('END:VALARM');
    }

    if (hw.description) {
      lines.push(`DESCRIPTION:${escapeICS(hw.description)}`);
    }

    lines.push(`DTSTAMP:${formatICSDate(new Date())}`);
    lines.push('STATUS:NEEDS-ACTION');
    lines.push('END:VTODO');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/**
 * Format Date to ICS datetime string (UTC).
 */
function formatICSDate(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters for ICS values.
 */
function escapeICS(str) {
  return (str || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Trigger a .ics file download in the browser.
 */
function downloadICS(homeworkList) {
  const content = generateICS(homeworkList);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = '网络学堂作业.ics';
  a.click();
  URL.revokeObjectURL(url);
}

export { generateTextList, generateICS, downloadICS };
