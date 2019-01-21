properties([
    buildDiscarder(logRotator(numToKeepStr: "25"))
])
node('docker/rsqa/base') {
    currentBuild.result = "SUCCESS"
    try {
        stage('Checkout') {
            sh """
                git clone https://github.com/zowe/zlux-shared.git
                git clone https://github.com/zowe/zlux-platform.git
            """
            dir('zlux-server-framework'){
                checkout scm
            }
        }
        stage('Build') {
            sh """
                cd zlux-shared/src/logging
                npm install && npm run build
            """
        }
        stage('Test') {
            ansiColor('xterm') {
                sh """
                    cd zlux-server-framework
                    npm install
                    npm test -- \\
                        --reporter mochawesome \\
                        --reporter-options reportDir=reports,reportFilename=index,html=true,json=true,quiet=true
                """
            }
        }
    } catch (err) {
        currentBuild.result = 'FAILURE'
    } finally {
        stage('Report') {
            emailext(
                subject: """${env.JOB_NAME} [${env.BUILD_NUMBER}]: ${currentBuild.result}""",
                attachLog: true,
                mimeType: "text/html",
                recipientProviders: [
                    [$class: 'RequesterRecipientProvider'],
                    [$class: 'CulpritsRecipientProvider'],
                    [$class: 'DevelopersRecipientProvider'],
                    [$class: 'UpstreamComitterRecipientProvider']
                ],
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
                            <li>Console output: <a href="${env.BUILD_URL}console">
                                ${env.JOB_NAME} [${env.BUILD_NUMBER}]</a></li>
                        </ul>
                        <hr/>
                    </body>
                    </html>
                    """
            )
            publishHTML([
                allowMissing: true,
                alwaysLinkToLastBuild: true,
                keepAll: false,
                reportDir: 'zlux-server-framework/reports',
                reportFiles: 'index.html',
                reportName: 'Report',
                reportTitles: ''
            ])
        }
    }
}
