const test = require('node:test');
const assert = require('node:assert/strict');
const intake = require('./index');

test('subjectParts extracts project and scope from common quote subjects', () => {
  assert.deepEqual(intake.subjectParts('HILL RD // PILLOWS'), {
    subject: 'HILL RD // PILLOWS',
    project: 'HILL RD',
    scope: 'PILLOWS'
  });
});

test('normalizeDimension recognizes inch dimensions', () => {
  assert.equal(intake.normalizeDimension('Decorative pillow 15" x 21"'), '15 x 21');
  assert.equal(intake.normalizeDimension('Bolster 8 in by 16 in'), '8 x 16');
});

test('extractLikelyItemsFromText returns conservative item candidates', () => {
  const rows = intake.extractLikelyItemsFromText(
    [
      'Study Pillow qty 1 15" x 12" Muse Terracotta fabric',
      'This is unrelated copy',
      'Primary bolster 8" x 16" fabric TBD'
    ].join('\n'),
    'Schedule.pdf'
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0].room, 'Study');
  assert.equal(rows[0].item_type, 'pillow');
  assert.equal(rows[0].quantity, 1);
  assert.equal(rows[0].dimensions, '15 x 12');
  assert.equal(rows[1].item_type, 'bolster');
});

test('buildQuoteIntake works from provided thread and attachment review', async () => {
  const result = await intake.buildQuoteIntake({
    mailbox: 'chris',
    thread: {
      subject: 'HILL RD // PILLOWS',
      conversation_id: 'conv-1',
      message_count: 1,
      messages: [
        {
          id: 'msg-1',
          from: 'Admin1 | Jennifer Miller Studio <admin@jennifermillerstudio.com>',
          to: ['chris@prestigiocustom.com'],
          date_utc: '2026-05-01T18:49:01Z',
          hasAttachments: true,
          body: '<p>Can I please get a quote?</p>',
          bodyType: 'html'
        }
      ]
    },
    attachmentReview: {
      summary: { attachment_count: 1, pdf_count: 1 },
      attachments: [
        {
          name: 'Hill Rd Schedules.pdf',
          path: '/tmp/fake.pdf',
          kind: 'pdf',
          size: 100,
          sha256: 'abc',
          pdf: { pages: 2 },
          extracted_text_chars: 80,
          extracted_text: 'Study Pillow qty 1 15" x 12" Muse Terracotta fabric',
          rendered_pages: []
        }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.project, 'HILL RD');
  assert.equal(result.scope, 'PILLOWS');
  assert.equal(result.contacts[0].email, 'admin@jennifermillerstudio.com');
  assert.equal(result.attachments.likely_items.length, 1);
  assert.match(result.review_prompt, /Likely quote rows to verify/);
  assert.equal(result.recommended_next_action, 'prepare_quote_summary');
});

test('buildQuoteIntake flags missing attachments', async () => {
  const result = await intake.buildQuoteIntake({
    thread: {
      subject: 'PROJECT // QUOTE',
      messages: []
    },
    downloadAttachments: false
  });

  assert.equal(result.recommended_next_action, 'locate_attachments');
  assert.match(result.open_questions.join('\n'), /No attachments were reviewed/);
});

test('buildQuoteIntake uses latest message for attachment download fallback', async () => {
  const result = await intake.buildQuoteIntake({
    thread: {
      subject: 'quote for sofa',
      messages: [
        {
          id: 'msg-no-attachments-flag',
          from: 'Client <client@example.com>',
          to: ['chris@prestigiocustom.com'],
          date_utc: '2026-05-01T20:00:00Z',
          hasAttachments: false,
          body: 'Photos are attached inline.'
        }
      ]
    },
    downloadResult: {
      message_id: 'msg-no-attachments-flag',
      attachment_count: 1,
      total_bytes: 12,
      output_dir: '/tmp/out',
      skipped: []
    },
    attachmentReview: {
      summary: { attachment_count: 1, image_count: 1 },
      attachments: [
        {
          name: 'inline-image-1.jpg',
          path: '/tmp/out/inline-image-1.jpg',
          kind: 'image',
          size: 12,
          sha256: 'abc',
          image: { pixelWidth: 100, pixelHeight: 50 },
          extracted_text_chars: 0,
          rendered_pages: []
        }
      ]
    }
  });

  assert.equal(result.source_email.attachment_message_id, 'msg-no-attachments-flag');
  assert.equal(result.attachments.attachments.length, 1);
  assert.equal(result.recommended_next_action, 'review_manually');
});

test('buildQuoteIntake surfaces unrecovered expected inline images as blockers', async () => {
  const result = await intake.buildQuoteIntake({
    thread: {
      subject: 'FARLEY TRAIL // SECTIONAL',
      conversation_id: 'conv-inline',
      messages: [
        {
          id: 'msg-inline',
          from: 'Designer <designer@example.com>',
          to: ['chris@prestigiocustom.com'],
          date_utc: '2026-05-20T20:00:00Z',
          hasAttachments: true,
          body: 'Please quote from the inline photos.'
        }
      ]
    },
    downloadResult: {
      message_id: 'msg-inline',
      attachment_count: 1,
      total_bytes: 68,
      output_dir: '/tmp/out',
      attachments: [
        {
          id: 'inline-ok',
          name: 'room-photo.png',
          originalName: 'room-photo.png',
          contentType: 'image/png',
          contentId: 'room-photo',
          source: 'inline_attachment',
          path: '/tmp/out/room-photo.png',
          size: 68,
          sha256: 'abc'
        }
      ],
      skipped: [
        {
          id: 'inline-missing',
          name: 'image002',
          contentType: 'application/octet-stream',
          expectedInlineImage: true,
          contentId: 'farley-plan',
          referencedBy: 'cid:farley-plan',
          reason: 'inline_image_recovery_failed',
          detail: 'Attachment bytes did not match allowed signatures.'
        }
      ]
    },
    attachmentReview: {
      summary: { attachment_count: 1, image_count: 1 },
      attachments: [
        {
          name: 'room-photo.png',
          path: '/tmp/out/room-photo.png',
          kind: 'image',
          size: 68,
          sha256: 'abc',
          image: { pixelWidth: 100, pixelHeight: 50 },
          extracted_text_chars: 0,
          rendered_pages: []
        }
      ]
    }
  });

  assert.equal(result.blockers.length, 1);
  assert.equal(result.blockers[0].content_id, 'farley-plan');
  assert.equal(result.recommended_next_action, 'resolve_attachment_blockers');
  assert.match(result.open_questions.join('\n'), /farley-plan/);
  assert.match(result.review_prompt, /Blocking attachment issues/);
  assert.equal(result.download.attachments[0].contentId, 'room-photo');
});

test('collectReferenceImagePaths includes image attachments and rendered PDF pages', () => {
  const paths = intake.collectReferenceImagePaths({
    attachments: [
      {
        name: 'photo.jpg',
        path: '/tmp/photo.jpg',
        rendered_pages: []
      },
      {
        name: 'drawing.pdf',
        path: '/tmp/drawing.pdf',
        rendered_pages: [{ path: '/tmp/drawing-page-1.png' }]
      },
      {
        name: 'notes.txt',
        path: '/tmp/notes.txt',
        rendered_pages: []
      }
    ]
  });

  assert.deepEqual(paths, ['/tmp/photo.jpg', '/tmp/drawing-page-1.png']);
});

test('applyReferenceImagesToPayload merges intake images onto draft items', () => {
  const payload = {
    items: [
      {
        category: 'seating',
        item_name: 'CHAIR',
        reference_image_paths: ['/tmp/existing.png']
      }
    ]
  };
  intake.applyReferenceImagesToPayload(payload, {
    attachments: {
      attachments: [
        { path: '/tmp/photo.jpg', rendered_pages: [{ path: '/tmp/page-1.png' }] }
      ]
    }
  });

  assert.deepEqual(payload.items[0].reference_image_paths, [
    '/tmp/existing.png',
    '/tmp/photo.jpg',
    '/tmp/page-1.png'
  ]);
});

test('handoffIntakeRequest resolves mailbox and subject from handoff packet', () => {
  const request = intake.handoffIntakeRequest({
    sourcePacket: {
      mailboxKey: 'chris',
      subject: 'Cross / Bedroom 3 / Pair of Chairs',
      messageId: 'message-123'
    }
  });

  assert.equal(request.mailbox, 'chris');
  assert.equal(request.subject, 'Cross / Bedroom 3 / Pair of Chairs');
  assert.equal(request.messageId, 'message-123');
});
