import wrapSubmitView from './wrapSubmitView';

function load() {
    const covalic = window.covalic;
    const challengeId = '560d7856cad3a57cfde481ba';

    // Install submission wrapper if we are running the covalic
    // app, otherwise this plugin is a noop.
    if (!covalic) {
        return;
    }

    wrapSubmitView(
        covalic.views.body.SubmitView,
        covalic.collections.SubmissionCollection,
        covalic.router,
        challengeId
    );
}

$(load);
