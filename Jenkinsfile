def customParameters = []
for (param in ["PR_EXPLORER_SERVER_AUTH", "PR_SAMPLE_ANGULAR_APP", "PR_SAMPLE_IFRAME_APP",
        "PR_SAMPLE_REACT_APP", "PR_TN3270_NG2", "PR_VT_NG2", "PR_ZLUX_APP_MANAGER",
        "PR_ZLUX_APP_SERVER", "PR_ZLUX_BUILD", "PR_ZLUX_EDITOR", "PR_ZLUX_NG2", "PR_ZLUX_PLATFORM",
        "PR_ZLUX_SHARED", "PR_ZLUX_WORKFLOW", "PR_ZLUX_WORKFLOW", "PR_ZOS_SUBSYSTEMS",
        "PR_ZOSMF_AUTH", "PR_ZSS_AUTH"]) {
    customParameters.push(
        string(
            name: param,
            defaultValue: "",
            description: "Pull request number",
            trim: true
        )
    )
}
properties([
    buildDiscarder(logRotator(numToKeepStr: "25")),
    parameters(customParameters)
])
node('docker/rsqa/base') {
    currentBuild.result = "SUCCESS"
    stage('Checkout') {
        sh """
            git clone https://github.com/zowe/zlux.git
            cd zlux
            # We don't want to install ssh key to container
            sed -i 's/git@github.com:zowe/https:\\/\\/github.com\\/zowe/' .gitmodules
            git submodule update --init --recursive --force --remote
            git submodule foreach "git checkout master"
            rm -rf zlux-server-framework
        """
        params.each {
            key, value ->
            if (key.startsWith("PR_") && value) {
                sh """
                    cd zlux/${key[3..-1].toLowerCase().replaceAll('_', '-')}
                    git fetch origin pull/${value}/head:pr
                    git checkout pr
                """
            }
        }
        dir('zlux/zlux-server-framework'){
            checkout scm
        }
    }
    stage('Build') {
        sh """
            cd zlux
            # We still don't want to install ssh key to container
            sed -i 's/git+ssh:\\/\\/git@github.com\\/zowe/https:\\/\\/github.com\\/zowe/' sample-angular-app/webClient/package.json
            sed -i 's/git+ssh:\\/\\/git@github.com\\/zowe/https:\\/\\/github.com\\/zowe/' sample-angular-app/webClient/package-lock.json
            sed -i 's/git+ssh:\\/\\/git@github.com:zowe/https:\\/\\/github.com\\/zowe/' zlux-workflow/webClient/package.json
            cd zlux-build
            ./build.sh
        """
    }
    try {
        stage('Test') {
            ansiColor('xterm') {
                sh """
                    cd zlux/zlux-server-framework
                    npm test -- \\
                        --reporter mochawesome \\
                        --reporter-options reportDir=reports,reportFilename=index,html=true,json=true,quiet=true
                """
            }
    } catch (err) {
        currentBuild.result = 'FAILURE'
    } finally {
        stage('Report') {
            publishHTML([
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: false,
                reportDir: 'zlux/zlux-server-framework/reports',
                reportFiles: 'index.html',
                reportName: 'Report',
                reportTitles: ''
            ])
            def prettyParams = ""
            params.each{ key, value -> prettyParams += "<br/>&nbsp;&nbsp;&nbsp;${key} = '${value}'"}
            emailext(
                subject: """${env.JOB_NAME} [${env.BUILD_NUMBER}]: ${currentBuild.result}""",
                attachLog: true,
                mimeType: "text/html",
                recipientProviders: [
                    [$class: 'RequesterRecipientProvider'],
                    [$class: 'CulpritsRecipientProvider'],
                    [$class: 'DevelopersRecipientProvider'],
                    [$class: 'UpstreamComitterRecipientProvider']
                ]
                body: """
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>Build report</title>
                    </head>
                    <body>
                        <p><b>${currentBuild.result}</b></p>
                        <hr/>
                        <ul>
                            <li>Duration: ${currentBuild.durationString[0..-14]}</li>
                            <li>Parameters: ${prettyParams}</li>
                            <li>Console output: <a href="${env.BUILD_URL}console">
                                ${env.JOB_NAME} [${env.BUILD_NUMBER}]</a></li>
                        </ul>
                        <hr/>
                    </body>
                    </html>
                    """
            )
        }
    }
}
