import wrapPhaseView from './wrapPhaseView';
import wrapSubmitView from './wrapSubmitView';

function load() {
    const covalic = window.covalic;

    // Install submission wrapper if we are running the covalic
    // app, otherwise this plugin is a noop.
    if (!covalic) {
        return;
    }

    wrapSubmitView(
        covalic.views.body.SubmitView,
        covalic.collections.SubmissionCollection,
        covalic.router
    );

    wrapPhaseView(
        covalic.views.body.PhaseView
    );
}

$(load);
